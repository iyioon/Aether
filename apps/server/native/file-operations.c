#define _GNU_SOURCE
#define _DARWIN_C_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#ifdef __APPLE__
#include <copyfile.h>
#include <CommonCrypto/CommonDigest.h>
#include <sys/acl.h>
#include <sys/attr.h>
#define st_atim st_atimespec
#define st_mtim st_mtimespec
#define st_ctim st_ctimespec
#else
#include <sys/random.h>
#include <sys/syscall.h>
#endif
#include <sys/types.h>
#include <sys/xattr.h>
#include <unistd.h>

/* The parent process passes pinned directory descriptors as fd 3 and fd 4.
 * This helper never resolves an absolute path or follows a source symlink. */
enum { UNSUPPORTED = 20, UNSAFE = 21, CHANGED = 22, CONFLICT = 23,
       CROSS_DEVICE = 24, REVIEW = 25, IO_ERROR = 26 };

static int rename_exclusive(int from, const char *source, int to, const char *destination) {
#ifdef __APPLE__
  return renameatx_np(from, source, to, destination, RENAME_EXCL);
#else
  return (int)syscall(SYS_renameat2, from, source, to, destination, RENAME_NOREPLACE);
#endif
}

static int durable_sync(int descriptor) {
  if (fsync(descriptor)) return -1;
#ifdef __APPLE__
  struct stat value;
  if (fstat(descriptor, &value)) return -1;
  if (S_ISREG(value.st_mode) && fcntl(descriptor, F_FULLFSYNC) < 0) return -1;
#endif
  return 0;
}

static int failure(int error) {
  if (error == EEXIST || error == ENOTEMPTY) return CONFLICT;
  if (error == EXDEV) return CROSS_DEVICE;
  if (error == ENOSYS || error == EOPNOTSUPP || error == EINVAL)
    return UNSUPPORTED;
  if (error == ELOOP || error == ENOTDIR) return UNSAFE;
  if (error == ENOENT) return CHANGED;
  return IO_ERROR;
}

static int basename_valid(const char *name) {
  return name[0] && strcmp(name, ".") && strcmp(name, "..") &&
         !strchr(name, '/') && strlen(name) <= 255;
}

static int supported(const struct stat *value) {
#ifdef __APPLE__
  if (value->st_flags & (UF_IMMUTABLE | UF_APPEND | SF_IMMUTABLE | SF_APPEND)) return 0;
#ifdef SF_DATALESS
  if (value->st_flags & SF_DATALESS) return 0;
#endif
#endif
  return !(value->st_mode & 07000) &&
         (S_ISDIR(value->st_mode) ||
          (S_ISREG(value->st_mode) && value->st_nlink == 1));
}

static int expected(const struct stat *value, const char *token) {
  uintmax_t dev, ino, size;
  intmax_t mtime, ctime;
  char trailing;
  if (sscanf(token, "%ju:%ju:%ju:%jd:%jd%c", &dev, &ino, &size,
             &mtime, &ctime, &trailing) != 5) return 0;
  return dev == (uintmax_t)value->st_dev && ino == (uintmax_t)value->st_ino &&
         size == (uintmax_t)value->st_size &&
         mtime == (intmax_t)value->st_mtim.tv_sec * 1000000000 + value->st_mtim.tv_nsec &&
         ctime == (intmax_t)value->st_ctim.tv_sec * 1000000000 + value->st_ctim.tv_nsec;
}

static int same_moved_entry(const struct stat *before, const struct stat *after) {
  /* rename changes ctime, but must preserve the object, contents and mode. */
  return before->st_dev == after->st_dev && before->st_ino == after->st_ino &&
         before->st_size == after->st_size && before->st_mode == after->st_mode &&
         before->st_mtim.tv_sec == after->st_mtim.tv_sec &&
         before->st_mtim.tv_nsec == after->st_mtim.tv_nsec;
}

static ssize_t metadata_bytes(int descriptor) {
#ifdef __APPLE__
  ssize_t length = flistxattr(descriptor, NULL, 0, 0);
  if (length < 0 || length > 1024 * 1024) return -1;
  char *names = malloc(length ? (size_t)length : 1);
  if (!names) return -1;
  if (flistxattr(descriptor, names, (size_t)length, 0) != length) { free(names); return -1; }
  size_t total = (size_t)length;
  for (ssize_t offset = 0; offset < length;) {
    const char *name = names + offset;
    size_t name_length = strnlen(name, (size_t)(length - offset));
    if (name_length == (size_t)(length - offset)) { free(names); return -1; }
    offset += (ssize_t)name_length + 1;
    ssize_t bytes = fgetxattr(descriptor, name, NULL, 0, 0, 0);
    if (bytes < 0 || (size_t)bytes > 64 * 1024 * 1024 - total) { free(names); return -1; }
    total += (size_t)bytes;
  }
  free(names);
  errno = 0;
  acl_t acl = acl_get_fd_np(descriptor, ACL_TYPE_EXTENDED);
  if (!acl && errno != ENOENT) return -1;
  if (acl) {
    acl_entry_t entry;
    errno = 0;
    if (acl_get_entry(acl, ACL_FIRST_ENTRY, &entry) == 0) {
      ssize_t bytes = acl_size(acl);
      if (bytes < 0 || (size_t)bytes > 64 * 1024 * 1024 - total) {
        acl_free(acl); return -1;
      }
      total += (size_t)bytes;
    } else if (errno != EINVAL) { acl_free(acl); return -1; }
    acl_free(acl);
  }
  return (ssize_t)total;
#else
  (void)descriptor;
  return 0;
#endif
}

#ifdef __APPLE__
static acl_t read_acl(int descriptor) {
  errno = 0;
  acl_t acl = acl_get_fd_np(descriptor, ACL_TYPE_EXTENDED);
  if (!acl && errno == ENOENT) return acl_init(0);
  return acl;
}

static void hash_u64(CC_SHA256_CTX *hash, uint64_t value) {
  unsigned char encoded[8];
  for (int index = 7; index >= 0; index--) { encoded[index] = value & 255; value >>= 8; }
  CC_SHA256_Update(hash, encoded, sizeof(encoded));
}
static void hash_blob(CC_SHA256_CTX *hash, const void *bytes, size_t length) {
  hash_u64(hash, length);
  CC_SHA256_Update(hash, bytes, (CC_LONG)length);
}
static int compare_names(const void *left, const void *right) {
  return strcmp(*(const char * const *)left, *(const char * const *)right);
}
/* This fingerprint accompanies the byte digest through inventory and recovery,
 * so same-size metadata changes cannot pass complete-copy verification. */
static int metadata_fingerprint(int descriptor, const struct stat *before, char output[65]) {
  CC_SHA256_CTX hash;
  CC_SHA256_Init(&hash);
  hash_blob(&hash, "aether-metadata-v1", 18);
  hash_u64(&hash, before->st_uid);
  hash_u64(&hash, before->st_gid);
  hash_u64(&hash, before->st_mode & 07777);
  hash_u64(&hash, before->st_flags);
  hash_u64(&hash, (uint64_t)before->st_birthtimespec.tv_sec);
  hash_u64(&hash, before->st_birthtimespec.tv_nsec);
  acl_t acl = read_acl(descriptor);
  if (!acl) return 0;
  ssize_t acl_length = acl_size(acl);
  if (acl_length < 0 || acl_length > 1024 * 1024) { acl_free(acl); return 0; }
  void *acl_bytes = malloc(acl_length ? (size_t)acl_length : 1);
  if (!acl_bytes) { acl_free(acl); return 0; }
  int valid_acl = acl_copy_ext(acl_bytes, acl, acl_length) == acl_length;
  acl_free(acl);
  if (!valid_acl) { free(acl_bytes); return 0; }
  hash_blob(&hash, acl_bytes, (size_t)acl_length);
  free(acl_bytes);
  ssize_t length = flistxattr(descriptor, NULL, 0, 0);
  if (length < 0 || length > 1024 * 1024) return 0;
  char *names = malloc(length ? (size_t)length : 1);
  char **sorted = calloc(length ? (size_t)length : 1, sizeof(char *));
  if (!names || !sorted) { free(names); free(sorted); return 0; }
  int valid = flistxattr(descriptor, names, (size_t)length, 0) == length;
  size_t count = 0, total = (size_t)length + (size_t)acl_length;
  for (ssize_t offset = 0; valid && offset < length;) {
    size_t name_length = strnlen(names + offset, (size_t)(length - offset));
    if (name_length == (size_t)(length - offset)) { valid = 0; break; }
    sorted[count++] = names + offset;
    offset += (ssize_t)name_length + 1;
  }
  qsort(sorted, count, sizeof(char *), compare_names);
  hash_u64(&hash, count);
  for (size_t index = 0; valid && index < count; index++) {
    const char *name = sorted[index];
    ssize_t bytes = fgetxattr(descriptor, name, NULL, 0, 0, 0);
    if (bytes < 0 || total > 64 * 1024 * 1024 || (size_t)bytes > 64 * 1024 * 1024 - total) { valid = 0; break; }
    total += (size_t)bytes;
    void *value = malloc(bytes ? (size_t)bytes : 1);
    if (!value) { valid = 0; break; }
    valid = fgetxattr(descriptor, name, value, (size_t)bytes, 0, 0) == bytes;
    if (valid) { hash_blob(&hash, name, strlen(name)); hash_blob(&hash, value, (size_t)bytes); }
    free(value);
  }
  free(names); free(sorted);
  struct stat after;
  if (!valid || fstat(descriptor, &after) || !same_moved_entry(before, &after) ||
      before->st_ctim.tv_sec != after.st_ctim.tv_sec || before->st_ctim.tv_nsec != after.st_ctim.tv_nsec) return 0;
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256_Final(digest, &hash);
  for (size_t index = 0; index < sizeof(digest); index++) snprintf(output + index * 2, 3, "%02x", digest[index]);
  return 1;
}
#endif

static int result(const struct stat *value, int descriptor) {
  ssize_t metadata = metadata_bytes(descriptor);
  if (metadata < 0) return UNSUPPORTED;
#ifdef __APPLE__
  char fingerprint[65];
  if (!metadata_fingerprint(descriptor, value, fingerprint)) return UNSUPPORTED;
#endif
  printf("{\"dev\":\"%ju\",\"ino\":\"%ju\",\"size\":\"%ju\","
         "\"mtimeNs\":\"%jd\",\"ctimeNs\":\"%jd\",\"mode\":%u,\"kind\":\"%s\",\"metadataBytes\":%zd",
         (uintmax_t)value->st_dev, (uintmax_t)value->st_ino,
         (uintmax_t)value->st_size,
         (intmax_t)value->st_mtim.tv_sec * 1000000000 + value->st_mtim.tv_nsec,
         (intmax_t)value->st_ctim.tv_sec * 1000000000 + value->st_ctim.tv_nsec,
         value->st_mode & 07777, S_ISDIR(value->st_mode) ? "directory" : "file", metadata);
#ifdef __APPLE__
  printf(",\"metadataSha256\":\"%s\"", fingerprint);
#endif
  printf("}\n");
  return 0;
}

#ifdef __APPLE__
/* Copy metadata values into an operation-owned entry with bounded buffers.
 * A growing attribute fails ERANGE instead of exceeding the reserved budget. */
static int copy_attributes(int source, int destination) {
  ssize_t target_length = flistxattr(destination, NULL, 0, 0);
  if (target_length < 0 || target_length > 1024 * 1024) return 0;
  char *target_names = malloc(target_length ? (size_t)target_length : 1);
  if (!target_names) return 0;
  if (flistxattr(destination, target_names, (size_t)target_length, 0) != target_length) {
    free(target_names); return 0;
  }
  for (ssize_t offset = 0; offset < target_length;) {
    const char *name = target_names + offset;
    size_t length = strnlen(name, (size_t)(target_length - offset));
    if (length == (size_t)(target_length - offset) || fremovexattr(destination, name, 0)) {
      free(target_names); return 0;
    }
    offset += (ssize_t)length + 1;
  }
  free(target_names);
  ssize_t list_length = flistxattr(source, NULL, 0, 0);
  if (list_length < 0 || list_length > 1024 * 1024) return 0;
  char *names = malloc(list_length ? (size_t)list_length : 1);
  if (!names) return 0;
  if (flistxattr(source, names, (size_t)list_length, 0) != list_length) { free(names); return 0; }
  size_t total = (size_t)list_length;
  int copied = 1;
  for (ssize_t offset = 0; offset < list_length;) {
    const char *name = names + offset;
    size_t length = strnlen(name, (size_t)(list_length - offset));
    if (length == (size_t)(list_length - offset)) { copied = 0; break; }
    offset += (ssize_t)length + 1;
    ssize_t bytes = fgetxattr(source, name, NULL, 0, 0, 0);
    if (bytes < 0 || (size_t)bytes > 64 * 1024 * 1024 - total) { copied = 0; break; }
    total += (size_t)bytes;
    void *value = malloc(bytes ? (size_t)bytes : 1);
    if (!value) { copied = 0; break; }
    copied = fgetxattr(source, name, value, (size_t)bytes, 0, 0) == bytes &&
             !fsetxattr(destination, name, value, (size_t)bytes, 0, 0);
    free(value);
    if (!copied) break;
  }
  free(names);
  return copied;
}

/* Verify all copied metadata before publication and source retirement. */
static int metadata_equal(int source, int destination, const struct stat *before) {
  struct stat after;
  if (fstat(destination, &after) || before->st_uid != after.st_uid ||
      before->st_gid != after.st_gid || before->st_flags != after.st_flags ||
      (before->st_mode & 07777) != (after.st_mode & 07777) ||
      before->st_mtim.tv_sec != after.st_mtim.tv_sec ||
      before->st_mtim.tv_nsec != after.st_mtim.tv_nsec ||
      before->st_birthtimespec.tv_sec != after.st_birthtimespec.tv_sec ||
      before->st_birthtimespec.tv_nsec != after.st_birthtimespec.tv_nsec) return 0;
  ssize_t length = flistxattr(source, NULL, 0, 0);
  ssize_t target_length = flistxattr(destination, NULL, 0, 0);
  if (length < 0 || length != target_length || length > 1024 * 1024) return 0;
  char *names = malloc(length ? (size_t)length : 1);
  if (!names) return 0;
  int equal = flistxattr(source, names, (size_t)length, 0) == length;
  size_t total = 0;
  for (ssize_t offset = 0; equal && offset < length;) {
    const char *name = names + offset;
    size_t name_length = strnlen(name, (size_t)(length - offset));
    if (name_length == (size_t)(length - offset)) { equal = 0; break; }
    offset += (ssize_t)name_length + 1;
    ssize_t bytes = fgetxattr(source, name, NULL, 0, 0, 0);
    ssize_t target_bytes = fgetxattr(destination, name, NULL, 0, 0, 0);
    if (bytes < 0 || bytes != target_bytes || (size_t)bytes > 64 * 1024 * 1024 - total) {
      equal = 0; break;
    }
    total += (size_t)bytes;
    void *left = malloc(bytes ? (size_t)bytes : 1);
    void *right = malloc(bytes ? (size_t)bytes : 1);
    if (!left || !right) equal = 0;
    else equal = fgetxattr(source, name, left, (size_t)bytes, 0, 0) == bytes &&
                 fgetxattr(destination, name, right, (size_t)bytes, 0, 0) == bytes &&
                 !memcmp(left, right, (size_t)bytes);
    free(left); free(right);
  }
  free(names);
  acl_t left_acl = read_acl(source);
  acl_t right_acl = read_acl(destination);
  if (!left_acl || !right_acl) equal = 0;
  else {
    ssize_t left_length = acl_size(left_acl), right_length = acl_size(right_acl);
    if (left_length < 0 || left_length != right_length || left_length > 1024 * 1024) equal = 0;
    else {
      void *left = malloc(left_length ? (size_t)left_length : 1);
      void *right = malloc(right_length ? (size_t)right_length : 1);
      if (!left || !right || acl_copy_ext(left, left_acl, left_length) != left_length ||
          acl_copy_ext(right, right_acl, right_length) != right_length ||
          memcmp(left, right, (size_t)left_length)) equal = 0;
      free(left); free(right);
    }
  }
  if (left_acl) acl_free(left_acl);
  if (right_acl) acl_free(right_acl);
  return equal;
}
#endif

static int probe(int directory) {
  struct stat parent;
  if (fstat(directory, &parent) || !S_ISDIR(parent.st_mode) ||
      parent.st_uid != geteuid() || (parent.st_mode & 0777) != 0700) return UNSAFE;
  unsigned long nonce;
#ifdef __APPLE__
  arc4random_buf(&nonce, sizeof(nonce));
#else
  if (getrandom(&nonce, sizeof(nonce), 0) != sizeof(nonce)) return IO_ERROR;
#endif
  char first[80], second[80], moved[80];
  for (int kind = 0; kind < 2; kind++) {
    snprintf(first, sizeof(first), "probe-%lx-%d-a", nonce, kind);
    snprintf(second, sizeof(second), "probe-%lx-%d-b", nonce, kind);
    snprintf(moved, sizeof(moved), "probe-%lx-%d-moved", nonce, kind);
    if (kind) {
      if (mkdirat(directory, first, 0700) || mkdirat(directory, second, 0700))
        return failure(errno);
    } else {
      int first_fd = openat(directory, first, O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
      if (first_fd < 0) return failure(errno);
      if (durable_sync(first_fd) || close(first_fd)) return IO_ERROR;
      int second_fd = openat(directory, second, O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
      if (second_fd < 0) return failure(errno);
      if (durable_sync(second_fd) || close(second_fd)) return IO_ERROR;
    }
    struct stat first_before, second_before, first_after, second_after;
    if (fstatat(directory, first, &first_before, AT_SYMLINK_NOFOLLOW) ||
        fstatat(directory, second, &second_before, AT_SYMLINK_NOFOLLOW)) return IO_ERROR;
    if (!rename_exclusive(directory, first, directory, second))
      return REVIEW;
    if (errno != EEXIST && errno != ENOTEMPTY) return failure(errno);
    if (fstatat(directory, first, &first_after, AT_SYMLINK_NOFOLLOW) ||
        fstatat(directory, second, &second_after, AT_SYMLINK_NOFOLLOW) ||
        !same_moved_entry(&first_before, &first_after) ||
        !same_moved_entry(&second_before, &second_after)) return REVIEW;
    if (rename_exclusive(directory, first, directory, moved))
      return failure(errno);
    if (fstatat(directory, moved, &first_after, AT_SYMLINK_NOFOLLOW) ||
        !same_moved_entry(&first_before, &first_after)) return REVIEW;
    if (unlinkat(directory, moved, kind ? AT_REMOVEDIR : 0) ||
        unlinkat(directory, second, kind ? AT_REMOVEDIR : 0)) return IO_ERROR;
  }
  if (durable_sync(directory) || fstat(directory, &parent)) return IO_ERROR;
  return result(&parent, directory);
}

int main(int argc, char **argv) {
  struct stat before, after;
  if (argc == 2 && !strcmp(argv[1], "probe")) return probe(3);
  if (argc == 2 && !strcmp(argv[1], "metadata")) {
    if (fstat(3, &before) || fstat(4, &after)) return failure(errno);
    if (!supported(&before) || !supported(&after) ||
        S_ISDIR(before.st_mode) != S_ISDIR(after.st_mode)) return UNSAFE;
#ifdef __APPLE__
    /* A copied data fork has been verified as ordinary bytes. Reattaching a
     * compressed representation would require copying its encoded data too. */
    if (before.st_flags & UF_COMPRESSED || metadata_bytes(3) < 0) return UNSUPPORTED;
    if (fcopyfile(3, 4, NULL, COPYFILE_STAT) || !copy_attributes(3, 4)) return UNSUPPORTED;
    struct attrlist creation = {0};
    struct { struct timespec birth, modified, accessed; } times = {
      before.st_birthtimespec, before.st_mtim, before.st_atim
    };
    creation.bitmapcount = ATTR_BIT_MAP_COUNT;
    creation.commonattr = ATTR_CMN_CRTIME | ATTR_CMN_MODTIME | ATTR_CMN_ACCTIME;
    if (fsetattrlist(4, &creation, &times, sizeof(times), 0)) return UNSUPPORTED;
    acl_t source_acl = read_acl(3);
    if (!source_acl) return UNSUPPORTED;
    int acl_result = acl_set_fd_np(4, source_acl, ACL_TYPE_EXTENDED);
    acl_free(source_acl);
    if (acl_result) return UNSUPPORTED;
    if (!metadata_equal(3, 4, &before)) return UNSUPPORTED;
#else
    struct timespec times[2] = {before.st_atim, before.st_mtim};
    if (fchown(4, before.st_uid, before.st_gid) ||
        fchmod(4, before.st_mode & 0777) || futimens(4, times))
      return UNSUPPORTED;
#endif
    if (durable_sync(4)) return UNSUPPORTED;
    if (fstat(4, &after)) return failure(errno);
    return result(&after, 4);
  }
  if (argc == 2 && !strcmp(argv[1], "check")) {
    if (fstat(3, &before)) return failure(errno);
    if (!supported(&before)) return UNSAFE;
#ifndef __APPLE__
    ssize_t attributes = flistxattr(3, NULL, 0);
    if (attributes < 0) return failure(errno);
    /* ACLs, resource forks, capabilities and other xattrs need explicit copying.
     * Reject rather than silently discarding filesystem metadata. */
    if (attributes) return UNSUPPORTED;
#endif
    return result(&before, 3);
  }
  if (argc != 5 || strcmp(argv[1], "rename") ||
      !basename_valid(argv[2]) || !basename_valid(argv[3])) return UNSAFE;
  if (fstatat(3, argv[2], &before, AT_SYMLINK_NOFOLLOW)) return failure(errno);
  if (!supported(&before)) return UNSAFE;
  if (!expected(&before, argv[4])) return CHANGED;
  if (rename_exclusive(3, argv[2], 4, argv[3]))
    return failure(errno);
  /* A hostile leaf replacement between validation and rename is retained at
   * the journaled destination for recovery; never blindly unlink or retry. */
  if (fstatat(4, argv[3], &after, AT_SYMLINK_NOFOLLOW) ||
      !same_moved_entry(&before, &after)) return REVIEW;
  if (durable_sync(3) || durable_sync(4)) return REVIEW;
  int moved = openat(4, argv[3], O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC);
  if (moved < 0) return REVIEW;
  struct stat opened;
  int outcome = fstat(moved, &opened) || !same_moved_entry(&after, &opened) ? REVIEW : result(&after, moved);
  close(moved);
  return outcome;
}
