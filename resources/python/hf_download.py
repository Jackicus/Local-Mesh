#!/usr/bin/env python3
"""Download one Hugging Face model snapshot, reporting progress as JSON lines.

    python -u hf_download.py --repo tencent/Hunyuan3D-2mini --dest <dir> [--allow "pat" ...]

stdout carries nothing but events (see resources/python/PROTOCOL.md's sibling
contract in the brief):

    {"event":"start","total":<bytes>,"files":<n>}
    {"event":"progress","downloaded":<bytes>,"total":<bytes>,"file":"<name>"}
    {"event":"done","downloaded":<bytes>}
    {"event":"error","message":"..."}

`snapshot_download` runs on a worker thread while the main thread samples
progress four times a second and reports the larger of two measures:

* the byte counters behind huggingface_hub's progress bars, supplied through
  `tqdm_class`. This is the only usable signal for a Xet transfer - the Xet
  backend buffers in its own chunk cache and writes **nothing** into `local_dir`
  until the file is complete, so a multi-gigabyte download would otherwise sit
  at 0% and then jump to 100%.
* bytes on disk under `dest`. This is what covers a resumed download, where
  files already present are never re-fetched and so never get a progress bar.

Exit codes: 0 done, 1 error, 130 terminated by SIGTERM (partial files are kept
and the next run resumes). Every exit goes through `os._exit`: the Xet transfer
backend runs a Rust thread pool that is not a Python daemon thread, so a normal
interpreter shutdown mid-transfer hangs forever waiting for it. Everything this
script writes is flushed as it is written, so there is nothing to lose.
"""
from __future__ import annotations

import argparse
import fnmatch
import json
import os
import signal
import sys
import threading
import time
import traceback

# Xet is the accelerated backend since huggingface_hub 1.0; HF_HUB_ENABLE_HF_TRANSFER
# is ignored there. Set before huggingface_hub is imported.
os.environ.setdefault("HF_XET_HIGH_PERFORMANCE", "1")
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")

POLL_SECONDS = 0.25
STDOUT = sys.stdout
sys.stdout = sys.stderr  # library prints must never reach the event stream

_emit_lock = threading.Lock()


def emit(payload: dict) -> None:
    with _emit_lock:
        STDOUT.write(json.dumps(payload) + "\n")
        STDOUT.flush()


def matches(name: str, patterns: list[str]) -> bool:
    if not patterns:
        return True
    return any(fnmatch.fnmatch(name, p) for p in patterns)


def remote_total(repo: str, patterns: list[str], token: str | None) -> tuple[int, list[str]]:
    """(bytes, file names) the download will produce, from the repo's metadata."""
    from huggingface_hub import HfApi

    info = HfApi().model_info(repo, files_metadata=True, token=token)
    total = 0
    names: list[str] = []
    for sibling in info.siblings or []:
        name = getattr(sibling, "rfilename", None)
        if not name or not matches(name, patterns):
            continue
        names.append(name)
        size = getattr(sibling, "size", None)
        lfs = getattr(sibling, "lfs", None)
        if size is None and lfs is not None:
            size = lfs.get("size") if isinstance(lfs, dict) else getattr(lfs, "size", None)
        total += int(size or 0)
    return total, names


def disk_usage(dest: str) -> tuple[int, str]:
    """(payload bytes under dest, newest finished file as a dest-relative path).

    Counts finished files plus the `*.incomplete` partials that huggingface_hub
    parks in `<dest>/.cache/huggingface/download`, and nothing else: the lock
    and metadata files next to them would otherwise push `downloaded` past
    `total` on small repos. The *name* only ever comes from a finished file -
    everything under `.cache` is named by content hash, which means nothing to
    a reader.
    """
    total = 0
    newest_mtime = -1.0
    newest_name = ""
    cache_root = os.path.join(dest, ".cache")
    for root, _dirs, names in os.walk(dest):
        in_cache = root == cache_root or root.startswith(cache_root + os.sep)
        for name in names:
            if in_cache and not name.endswith(".incomplete"):
                continue
            if name.endswith(".lock") or name == ".complete":
                continue
            path = os.path.join(root, name)
            try:
                st = os.stat(path)
            except OSError:
                continue
            total += st.st_size
            if not in_cache and st.st_mtime > newest_mtime:
                newest_mtime = st.st_mtime
                newest_name = os.path.relpath(path, dest)
    return total, newest_name


_bars: dict[int, int] = {}
_bars_lock = threading.Lock()


def transferred_bytes() -> int:
    with _bars_lock:
        return sum(_bars.values())


def progress_tqdm_class():
    """A tqdm subclass that records bytes instead of drawing bars."""
    from tqdm.auto import tqdm

    class Counting(tqdm):
        def __init__(self, *args, **kwargs):
            # `unit` and `desc` have to be read here: with disable=True tqdm's
            # __init__ returns before it assigns either of them.
            self._unit = kwargs.get("unit", "it")
            self._desc = kwargs.get("desc", "") or ""
            self._counted = 0
            kwargs["disable"] = True  # stderr is a log file, not a terminal
            super().__init__(*args, **kwargs)

        def _countable(self) -> bool:
            # "Fetching N files" counts files, not bytes; "Reconstructing ..."
            # re-reports bytes the download bar has already counted.
            if self._unit != "B":
                return False
            return "reconstruct" not in self._desc.lower()

        def update(self, n=1):
            self._counted += int(n or 0)
            if self._countable():
                with _bars_lock:
                    _bars[id(self)] = self._counted
            # disable=True makes the base update a no-op, which is the point
            return super().update(n)

    return Counting


class Downloader(threading.Thread):
    daemon = True

    def __init__(self, repo: str, dest: str, patterns: list[str], token: str | None):
        super().__init__(name="snapshot_download")
        self.repo = repo
        self.dest = dest
        self.patterns = patterns
        self.token = token
        self.error: BaseException | None = None

    def run(self) -> None:
        from huggingface_hub import snapshot_download

        try:
            snapshot_download(
                self.repo,
                local_dir=self.dest,
                allow_patterns=self.patterns or None,
                token=self.token,
                tqdm_class=progress_tqdm_class(),
            )
        except BaseException as exc:  # noqa: BLE001 - reported verbatim to main
            self.error = exc


def main() -> int:
    parser = argparse.ArgumentParser(description="Download an HF model snapshot with JSON progress.")
    parser.add_argument("--repo", required=True, help="Hugging Face repo id")
    parser.add_argument("--dest", required=True, help="destination directory")
    parser.add_argument("--allow", action="append", default=[], help="allow_patterns entry; repeatable")
    args = parser.parse_args()

    dest = os.path.abspath(os.path.expanduser(args.dest))
    patterns = list(args.allow)
    token = os.environ.get("HF_TOKEN") or None

    stop = threading.Event()

    def on_term(_signum, _frame):
        stop.set()

    signal.signal(signal.SIGTERM, on_term)
    signal.signal(signal.SIGINT, on_term)

    try:
        os.makedirs(dest, exist_ok=True)
        complete_marker = os.path.join(dest, ".complete")
        if os.path.exists(complete_marker):
            os.remove(complete_marker)

        total, names = remote_total(args.repo, patterns, token)
        emit({"event": "start", "total": total, "files": len(names)})
        # A Xet transfer never names the file it is working on, so a single-file
        # download can at least say what it is fetching.
        pending = names[0] if len(names) == 1 else ""

        worker = Downloader(args.repo, dest, patterns, token)
        worker.start()

        last_downloaded = -1
        while worker.is_alive():
            if stop.is_set():
                return 130  # partial files stay; the next run resumes
            on_disk, current = disk_usage(dest)
            downloaded = max(on_disk, transferred_bytes())
            if total:
                downloaded = min(downloaded, total)
            if downloaded != last_downloaded:
                last_downloaded = downloaded
                emit({
                    "event": "progress",
                    "downloaded": downloaded,
                    "total": total,
                    "file": current or pending,
                })
            time.sleep(POLL_SECONDS)

        worker.join()
        if stop.is_set():
            return 130
        if worker.error is not None:
            raise worker.error

        downloaded, _ = disk_usage(dest)
        with open(complete_marker, "w", encoding="utf-8") as fh:
            fh.write(args.repo + "\n")
        emit({"event": "progress", "downloaded": max(downloaded, total), "total": total or downloaded,
              "file": ""})
        emit({"event": "done", "downloaded": downloaded})
        return 0
    except KeyboardInterrupt:
        return 130
    except BaseException as exc:  # noqa: BLE001
        traceback.print_exc()
        emit({"event": "error", "message": f"{type(exc).__name__}: {exc}"})
        return 1


if __name__ == "__main__":
    code = main()
    try:
        sys.stderr.flush()
    except Exception:  # noqa: BLE001
        pass
    os._exit(code)
