#!/usr/bin/env python3
import argparse
import json
from pathlib import Path, PurePosixPath
import re


def path_value(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9._/+\-]+", value):
        raise ValueError("Invalid install path")
    path = PurePosixPath(value)
    if not path.parts or path.is_absolute() or ".." in path.parts or path.parts[0].startswith(".install-") or path.parts[0] == ".buckyos_installer_defaults":
        raise ValueError("Unsafe install path")
    return value


def create(component, version, platform, root):
    if component != "buckyosapp" or platform not in ("amd64-macos", "arm64-macos", "amd64-windows", "arm64-windows"):
        raise ValueError("Unsupported component or platform")
    if not re.fullmatch(r"[0-9]+(?:\.[0-9]+)*\+build[0-9]{6}", version):
        raise ValueError("Invalid component version")
    modules = {"buckyosapp": "buckyosapp.exe" if platform.endswith("-windows") else "BuckyOS.app/"}
    data_paths, clean_paths = [], []
    for value in modules.values():
        path_value(value)
        source = root / value
        if not source.exists():
            raise ValueError("Declared staged path is missing: " + value)
        if not source.resolve().is_relative_to(root.resolve()):
            raise ValueError("Staged path escapes its root: " + value)
        if value.endswith("/") and not source.is_dir():
            raise ValueError("Declared staged directory is not a directory: " + value)
    return {"schema": 1, "component": component, "version": version, "platform": platform,
            "modules": modules, "data_paths": data_paths, "clean_paths": clean_paths}


def main():
    parser = argparse.ArgumentParser(description="Add an installation description to an existing staged root")
    parser.add_argument("--component", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--platform", required=True)
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    descriptor = create(args.component, args.version, args.platform, args.root)
    destination = args.root / (".install-" + args.component + ".json")
    if destination.is_symlink():
        raise ValueError("Installation descriptor destination must not be a symlink")
    destination.write_text(json.dumps(descriptor, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
