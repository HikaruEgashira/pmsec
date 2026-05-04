from importlib.metadata import PackageNotFoundError, version as _pkg_version

try:
    __version__ = _pkg_version("pmsec")
except PackageNotFoundError:
    __version__ = "0.5.1"

__all__ = ["cli", "__version__"]
