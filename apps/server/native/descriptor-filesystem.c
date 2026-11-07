#define _GNU_SOURCE
#define _DARWIN_C_SOURCE
#include <node_api.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#ifdef __APPLE__
#include <sys/acl.h>
#endif
#include <unistd.h>

/* Only single names are accepted. All filesystem work runs on the libuv pool
 * relative to the caller's pinned descriptor, never by reconstructing a path. */
typedef struct {
  napi_async_work work;
  napi_deferred deferred;
  int operation, parent, flags, mode, descriptor, error, directory;
  char name[256];
  size_t limit, count;
  char **names;
  struct stat info;
  uint64_t expected_dev, expected_ino;
  int has_expected;
} request;
enum { OPEN, MKDIR, REMOVE, LIST, LSTAT, SYNC, REWIND, PRIVATE };

static const char *error_code(int error) {
  switch (error) {
    case ENOENT: return "ENOENT";
    case EEXIST: return "EEXIST";
    case ENOTEMPTY: return "ENOTEMPTY";
    case ELOOP: return "ELOOP";
    case ENOTDIR: return "ENOTDIR";
    case EACCES: return "EACCES";
    case EPERM: return "EPERM";
    case EBADF: return "EBADF";
    case ENOSPC: return "ENOSPC";
    case EROFS: return "EROFS";
    case EXDEV: return "EXDEV";
    case E2BIG: return "E2BIG";
    case ESTALE: return "ESTALE";
    case ENOTSUP: return "ENOTSUP";
    default: return "EIO";
  }
}

static int valid_name(const char *name) {
  if (!name[0] || !strcmp(name, ".") || !strcmp(name, "..")) return 0;
  for (const unsigned char *p = (const unsigned char *)name; *p; p++)
    if (*p == '/' || *p == '\\' || *p < 32 || *p == 127) return 0;
  return 1;
}

static void execute(napi_env env, void *data) {
  (void)env;
  request *r = data;
  switch (r->operation) {
    case OPEN:
      r->descriptor = openat(r->parent, r->name,
                             r->flags | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK,
                             r->mode);
      if (r->descriptor < 0) r->error = errno;
      break;
    case MKDIR:
      if (mkdirat(r->parent, r->name, r->mode)) r->error = errno;
      break;
    case REMOVE:
      if (r->has_expected) {
        if (fstatat(r->parent, r->name, &r->info, AT_SYMLINK_NOFOLLOW)) {
          r->error = errno;
          break;
        }
        if ((uint64_t)r->info.st_dev != r->expected_dev ||
            (uint64_t)r->info.st_ino != r->expected_ino) {
          r->error = ESTALE;
          break;
        }
      }
      if (unlinkat(r->parent, r->name, r->directory ? AT_REMOVEDIR : 0))
        r->error = errno;
      break;
    case LSTAT:
      if (fstatat(r->parent, r->name, &r->info, AT_SYMLINK_NOFOLLOW))
        r->error = errno;
      break;
    case PRIVATE: {
      if (fstat(r->parent, &r->info)) { r->error = errno; break; }
      if (!S_ISDIR(r->info.st_mode) || r->info.st_uid != geteuid() ||
          (r->info.st_mode & 07777) != 0700) { r->error = EACCES; break; }
#ifdef __APPLE__
      if (r->directory) {
        acl_t empty = acl_init(0);
        if (!empty) { r->error = errno; break; }
        if (acl_set_fd_np(r->parent, empty, ACL_TYPE_EXTENDED)) r->error = errno;
        acl_free(empty);
        if (r->error) break;
        if (fsync(r->parent)) { r->error = errno; break; }
      }
      errno = 0;
      acl_t acl = acl_get_fd_np(r->parent, ACL_TYPE_EXTENDED);
      if (!acl) { if (errno != ENOENT) r->error = errno ? errno : EIO; break; }
      acl_entry_t entry;
      errno = 0;
      int entries = acl_get_entry(acl, ACL_FIRST_ENTRY, &entry);
      /* Darwin returns zero for an entry and -1/EINVAL at the end. */
      if (entries == 0) r->error = EACCES;
      else if (errno != EINVAL) r->error = errno ? errno : EIO;
      acl_free(acl);
#endif
      break;
    }
    case REWIND:
      if (lseek(r->parent, 0, SEEK_SET) < 0) r->error = errno;
      break;
    case SYNC:
      if (fsync(r->parent)) { r->error = errno; break; }
#ifdef __APPLE__
      if (fstat(r->parent, &r->info)) { r->error = errno; break; }
      /* Directories support fsync, while full device-cache flushing is a file
       * operation. Fail closed if a writable volume cannot flush file data. */
      if (S_ISREG(r->info.st_mode) && fcntl(r->parent, F_FULLFSYNC) < 0)
        r->error = errno;
#endif
      break;
    case LIST: {
      int fd = openat(r->parent, ".", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
      if (fd < 0) { r->error = errno; break; }
      DIR *directory = fdopendir(fd);
      if (!directory) { r->error = errno; close(fd); break; }
      r->names = calloc(r->limit ? r->limit : 1, sizeof(char *));
      if (!r->names) { r->error = ENOMEM; closedir(directory); break; }
      struct dirent *entry;
      errno = 0;
      while ((entry = readdir(directory))) {
        if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
        if (r->count >= r->limit) { r->error = E2BIG; break; }
        r->names[r->count] = strdup(entry->d_name);
        if (!r->names[r->count]) { r->error = ENOMEM; break; }
        r->count++;
        errno = 0;
      }
      if (!r->error && errno) r->error = errno;
      if (closedir(directory) && !r->error) r->error = errno;
      break;
    }
  }
}

static void bigint(napi_env env, napi_value object, const char *name, uint64_t value) {
  napi_value number;
  napi_create_bigint_uint64(env, value, &number);
  napi_set_named_property(env, object, name, number);
}

static void complete(napi_env env, napi_status status, void *data) {
  request *r = data;
  napi_value value;
  if (status != napi_ok && !r->error) r->error = EIO;
  if (r->error) {
    if (r->operation == OPEN && r->descriptor >= 0) close(r->descriptor);
    napi_value code, message;
    napi_create_string_utf8(env, error_code(r->error), NAPI_AUTO_LENGTH, &code);
    napi_create_string_utf8(env, "Descriptor filesystem operation failed.", NAPI_AUTO_LENGTH, &message);
    napi_create_error(env, code, message, &value);
    napi_reject_deferred(env, r->deferred, value);
  } else {
    if (r->operation == OPEN) napi_create_int32(env, r->descriptor, &value);
    else if (r->operation == LIST) {
      napi_create_array_with_length(env, r->count, &value);
      for (size_t i = 0; i < r->count; i++) {
        napi_value name;
        /* Return bytes so JS can reject invalid UTF-8 instead of addressing a
         * different filename after replacement-character decoding. */
        napi_create_buffer_copy(env, strlen(r->names[i]), r->names[i], NULL, &name);
        napi_set_element(env, value, (uint32_t)i, name);
      }
    } else if (r->operation == LSTAT) {
      napi_create_object(env, &value);
      bigint(env, value, "dev", (uint64_t)r->info.st_dev);
      bigint(env, value, "ino", (uint64_t)r->info.st_ino);
      bigint(env, value, "size", (uint64_t)r->info.st_size);
      bigint(env, value, "mode", (uint64_t)r->info.st_mode);
      bigint(env, value, "nlink", (uint64_t)r->info.st_nlink);
      bigint(env, value, "uid", (uint64_t)r->info.st_uid);
    } else napi_get_undefined(env, &value);
    napi_resolve_deferred(env, r->deferred, value);
  }
  for (size_t i = 0; i < r->count; i++) free(r->names[i]);
  free(r->names);
  close(r->parent);
  napi_delete_async_work(env, r->work);
  free(r);
}

static napi_value invoke(napi_env env, napi_callback_info info) {
  napi_value args[7], resource, promise;
  size_t count = 7;
  void *operation;
  napi_get_cb_info(env, info, &count, args, NULL, &operation);
  request *r = calloc(1, sizeof(request));
  if (!r) { napi_throw_error(env, "ENOMEM", "Allocation failed."); return NULL; }
  r->operation = (int)(intptr_t)operation;
  r->descriptor = -1;
  int invalid = count < 1 || napi_get_value_int32(env, args[0], &r->parent) != napi_ok || r->parent < 0;
  if (r->operation == LIST) {
    uint32_t limit = 0;
    invalid |= count != 2 || napi_get_value_uint32(env, args[1], &limit) != napi_ok || limit > 100000;
    r->limit = limit;
  } else if (r->operation != SYNC && r->operation != REWIND && r->operation != PRIVATE) {
    size_t length = 0;
    invalid |= count < 2 || napi_get_value_string_utf8(env, args[1], NULL, 0, &length) != napi_ok || length > 255;
    if (!invalid) {
      napi_get_value_string_utf8(env, args[1], r->name, sizeof(r->name), &length);
      invalid |= !valid_name(r->name) || strlen(r->name) != length;
    }
  }
  if (r->operation == OPEN)
    invalid |= count != 4 || napi_get_value_int32(env, args[2], &r->flags) != napi_ok ||
               napi_get_value_int32(env, args[3], &r->mode) != napi_ok;
  if (r->operation == MKDIR)
    invalid |= count != 3 || napi_get_value_int32(env, args[2], &r->mode) != napi_ok;
  if (r->operation == PRIVATE) {
    bool created = false;
    invalid |= count != 2 || napi_get_value_bool(env, args[1], &created) != napi_ok;
    r->directory = created;
  }
  if (r->operation == REMOVE) {
    bool directory = false, lossless_dev = false, lossless_ino = false;
    invalid |= count != 3 && count != 5;
    if (!invalid) invalid |= napi_get_value_bool(env, args[2], &directory) != napi_ok;
    r->directory = directory;
    if (count == 5) {
      r->has_expected = 1;
      invalid |= napi_get_value_bigint_uint64(env, args[3], &r->expected_dev, &lossless_dev) != napi_ok ||
                 napi_get_value_bigint_uint64(env, args[4], &r->expected_ino, &lossless_ino) != napi_ok ||
                 !lossless_dev || !lossless_ino;
    }
  }
  if (invalid) {
    free(r);
    napi_throw_type_error(env, "EINVAL", "Invalid descriptor filesystem request.");
    return NULL;
  }
  int original_parent = r->parent;
  r->parent = fcntl(original_parent, F_DUPFD_CLOEXEC, 0);
  if (r->parent < 0) {
    const char *code = error_code(errno);
    free(r);
    napi_throw_error(env, code, "Unable to pin filesystem descriptor.");
    return NULL;
  }
  napi_create_string_utf8(env, "aether:descriptor-filesystem", NAPI_AUTO_LENGTH, &resource);
  if (napi_create_promise(env, &r->deferred, &promise) != napi_ok ||
      napi_create_async_work(env, NULL, resource, execute, complete, r, &r->work) != napi_ok) {
    close(r->parent);
    free(r);
    napi_throw_error(env, "EIO", "Unable to schedule filesystem operation.");
    return NULL;
  }
  if (napi_queue_async_work(env, r->work) != napi_ok) {
    napi_delete_async_work(env, r->work);
    close(r->parent);
    free(r);
    napi_throw_error(env, "EIO", "Unable to schedule filesystem operation.");
    return NULL;
  }
  return promise;
}

static napi_value initialize(napi_env env, napi_value exports) {
  const char *names[] = {"open", "mkdir", "remove", "list", "lstat", "sync", "rewind", "privateDirectory"};
  for (int i = 0; i < 8; i++) {
    napi_value function;
    napi_create_function(env, names[i], NAPI_AUTO_LENGTH, invoke, (void *)(intptr_t)i, &function);
    napi_set_named_property(env, exports, names[i], function);
  }
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
