#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/random.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/xattr.h>
#include <unistd.h>

/* The parent process passes pinned directory descriptors as fd 3 and fd 4.
 * This helper never resolves an absolute path or follows a source symlink. */
enum { UNSUPPORTED = 20, UNSAFE = 21, CHANGED = 22, CONFLICT = 23,
       CROSS_DEVICE = 24, REVIEW = 25, IO_ERROR = 26 };

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

static void result(const struct stat *value) {
  printf("{\"dev\":\"%ju\",\"ino\":\"%ju\",\"size\":\"%ju\","
         "\"mtimeNs\":\"%jd\",\"ctimeNs\":\"%jd\",\"mode\":%u,\"kind\":\"%s\"}\n",
         (uintmax_t)value->st_dev, (uintmax_t)value->st_ino,
         (uintmax_t)value->st_size,
         (intmax_t)value->st_mtim.tv_sec * 1000000000 + value->st_mtim.tv_nsec,
         (intmax_t)value->st_ctim.tv_sec * 1000000000 + value->st_ctim.tv_nsec,
         value->st_mode & 07777, S_ISDIR(value->st_mode) ? "directory" : "file");
}

static int probe(int directory) {
  struct stat parent;
  if (fstat(directory, &parent) || !S_ISDIR(parent.st_mode) ||
      parent.st_uid != geteuid() || (parent.st_mode & 0777) != 0700) return UNSAFE;
  unsigned long nonce;
  if (getrandom(&nonce, sizeof(nonce), 0) != sizeof(nonce)) return IO_ERROR;
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
      if (fsync(first_fd) || close(first_fd)) return IO_ERROR;
      int second_fd = openat(directory, second, O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
      if (second_fd < 0) return failure(errno);
      if (fsync(second_fd) || close(second_fd)) return IO_ERROR;
    }
    struct stat first_before, second_before, first_after, second_after;
    if (fstatat(directory, first, &first_before, AT_SYMLINK_NOFOLLOW) ||
        fstatat(directory, second, &second_before, AT_SYMLINK_NOFOLLOW)) return IO_ERROR;
    if (!syscall(SYS_renameat2, directory, first, directory, second, RENAME_NOREPLACE))
      return REVIEW;
    if (errno != EEXIST && errno != ENOTEMPTY) return failure(errno);
    if (fstatat(directory, first, &first_after, AT_SYMLINK_NOFOLLOW) ||
        fstatat(directory, second, &second_after, AT_SYMLINK_NOFOLLOW) ||
        !same_moved_entry(&first_before, &first_after) ||
        !same_moved_entry(&second_before, &second_after)) return REVIEW;
    if (syscall(SYS_renameat2, directory, first, directory, moved, RENAME_NOREPLACE))
      return failure(errno);
    if (fstatat(directory, moved, &first_after, AT_SYMLINK_NOFOLLOW) ||
        !same_moved_entry(&first_before, &first_after)) return REVIEW;
    if (unlinkat(directory, moved, kind ? AT_REMOVEDIR : 0) ||
        unlinkat(directory, second, kind ? AT_REMOVEDIR : 0)) return IO_ERROR;
  }
  if (fsync(directory) || fstat(directory, &parent)) return IO_ERROR;
  result(&parent);
  return 0;
}

int main(int argc, char **argv) {
  struct stat before, after;
  if (argc == 2 && !strcmp(argv[1], "probe")) return probe(3);
  if (argc == 2 && !strcmp(argv[1], "metadata")) {
    if (fstat(3, &before) || fstat(4, &after)) return failure(errno);
    if (!supported(&before) || !supported(&after) ||
        S_ISDIR(before.st_mode) != S_ISDIR(after.st_mode)) return UNSAFE;
    struct timespec times[2] = {before.st_atim, before.st_mtim};
    if (fchown(4, before.st_uid, before.st_gid) ||
        fchmod(4, before.st_mode & 0777) || futimens(4, times) || fsync(4))
      return UNSUPPORTED;
    if (fstat(4, &after)) return failure(errno);
    result(&after);
    return 0;
  }
  if (argc == 2 && !strcmp(argv[1], "check")) {
    if (fstat(3, &before)) return failure(errno);
    if (!supported(&before)) return UNSAFE;
    ssize_t attributes = flistxattr(3, NULL, 0);
    if (attributes < 0) return failure(errno);
    /* ACLs, resource forks, capabilities and other xattrs need explicit copying.
     * Reject rather than silently discarding filesystem metadata. */
    if (attributes) return UNSUPPORTED;
    result(&before);
    return 0;
  }
  if (argc != 5 || strcmp(argv[1], "rename") ||
      !basename_valid(argv[2]) || !basename_valid(argv[3])) return UNSAFE;
  if (fstatat(3, argv[2], &before, AT_SYMLINK_NOFOLLOW)) return failure(errno);
  if (!supported(&before)) return UNSAFE;
  if (!expected(&before, argv[4])) return CHANGED;
  if (syscall(SYS_renameat2, 3, argv[2], 4, argv[3], RENAME_NOREPLACE))
    return failure(errno);
  /* A hostile leaf replacement between validation and rename is retained at
   * the journaled destination for recovery; never blindly unlink or retry. */
  if (fstatat(4, argv[3], &after, AT_SYMLINK_NOFOLLOW) ||
      !same_moved_entry(&before, &after)) return REVIEW;
  if (fsync(3) || fsync(4)) return REVIEW;
  result(&after);
  return 0;
}
