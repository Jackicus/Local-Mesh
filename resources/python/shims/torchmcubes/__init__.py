"""CPU drop-in for the `torchmcubes` CUDA extension (github.com/tatsy/torchmcubes).

TripoSR imports `from torchmcubes import marching_cubes` in tsr/models/isosurface.py.
Building the real package needs the CUDA toolkit (nvcc), which most users don't
have, so the worker puts this directory on sys.path *after* site-packages: a real
torchmcubes install wins, otherwise this module is used.

Output conventions match torchmcubes exactly (see cxx/mcubes_cpu.cpp upstream):
  - `vol` is indexed [z][y][x] (shape (Nz, Ny, Nx));
  - returned vertices are (x, y, z) in grid-index units, i.e. column 0 indexes
    the *last* axis of `vol`. TripoSR's MarchingCubeHelper then does
    `v_pos[..., [2, 1, 0]]` to get back to (i, j, k) order.
  - faces are an (M, 3) integer tensor.
Face winding may differ from the CUDA kernel; worker.py normalises orientation
with a signed-volume check after generation, so nothing downstream depends on it.
"""
from __future__ import annotations

from typing import Tuple

import numpy as np
import torch

try:  # PyMCubes (base.txt) is the fast path
    import mcubes as _mcubes
except ImportError:  # pragma: no cover - fallback
    _mcubes = None

try:
    from skimage import measure as _measure
except ImportError:  # pragma: no cover
    _measure = None

HAS_CUDA = False
__version__ = "0.1.0+localmesh-shim"


def _mc_numpy(vol: np.ndarray, thresh: float) -> Tuple[np.ndarray, np.ndarray]:
    if _mcubes is not None:
        verts, faces = _mcubes.marching_cubes(vol, thresh)
        return np.asarray(verts, dtype=np.float32), np.asarray(faces, dtype=np.int64)
    if _measure is not None:
        verts, faces, _normals, _values = _measure.marching_cubes(vol, level=thresh, method="lewiner")
        return np.asarray(verts, dtype=np.float32), np.asarray(faces, dtype=np.int64)
    raise ImportError("torchmcubes shim needs PyMCubes or scikit-image installed")


def marching_cubes(vol: torch.Tensor, thresh: float) -> Tuple[torch.Tensor, torch.Tensor]:
    """vol: 3D tensor (Nz, Ny, Nx); returns (verts (N,3) float32 in (x,y,z) index units, faces (M,3) int64)."""
    if vol.ndim != 3:
        raise ValueError(f"marching_cubes expects a 3D volume, got shape {tuple(vol.shape)}")
    device = vol.device
    arr = vol.detach().to("cpu", torch.float32).contiguous().numpy()
    verts, faces = _mc_numpy(arr, float(thresh))
    if len(verts) == 0:
        return (torch.zeros((0, 3), dtype=torch.float32, device=device),
                torch.zeros((0, 3), dtype=torch.int64, device=device))
    # numpy/skimage/mcubes give (i, j, k) = (z, y, x) index order; torchmcubes gives (x, y, z)
    verts = np.ascontiguousarray(verts[:, ::-1])
    return torch.from_numpy(verts).to(device), torch.from_numpy(faces).to(device)


def grid_interp(vol: torch.Tensor, points: torch.Tensor) -> torch.Tensor:
    """Trilinear interpolation. vol: (C, Nz, Ny, Nx); points: (Np, 3) as (x, y, z) in index units -> (Np, C)."""
    from scipy.ndimage import map_coordinates

    device = vol.device
    v = vol.detach().to("cpu", torch.float32).numpy()
    p = points.detach().to("cpu", torch.float32).numpy()
    coords = [p[:, 2], p[:, 1], p[:, 0]]  # map_coordinates wants (z, y, x)
    out = np.stack([map_coordinates(v[c], coords, order=1, mode="nearest") for c in range(v.shape[0])], axis=-1)
    return torch.from_numpy(out.astype(np.float32)).to(device)


__all__ = ["marching_cubes", "grid_interp", "HAS_CUDA"]
