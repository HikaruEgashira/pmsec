from importlib.metadata import PackageNotFoundError, version as _pkg_version

try:
    __version__ = _pkg_version("pmsec")
except PackageNotFoundError:
    __version__ = "0.9.0"

__all__ = ["cli", "__version__"]
