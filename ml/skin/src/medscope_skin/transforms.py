from __future__ import annotations

import random

import numpy as np
import torch
from PIL import Image, ImageOps


class ImageTransform:
    def __init__(self, size: int, mean: list[float], std: list[float], training: bool = False, horizontal_flip: bool = True) -> None:
        self.size = size
        self.mean = np.asarray(mean, dtype=np.float32).reshape(1, 1, 3)
        self.std = np.asarray(std, dtype=np.float32).reshape(1, 1, 3)
        self.training = training
        self.horizontal_flip = horizontal_flip

    def __call__(self, source: Image.Image) -> torch.Tensor:
        image = source.convert("RGB")
        image = ImageOps.fit(
            image,
            (self.size, self.size),
            method=Image.Resampling.LANCZOS,
            centering=(0.5, 0.5),
        )
        if self.training and self.horizontal_flip and random.random() < 0.5:
            image = ImageOps.mirror(image)
        pixels = np.asarray(image, dtype=np.float32).copy() / 255.0
        normalized = (pixels - self.mean) / self.std
        return torch.from_numpy(normalized.transpose(2, 0, 1).copy())

