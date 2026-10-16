from __future__ import annotations

import torch
from torch import nn


class _ConvBlock(nn.Module):
    def __init__(self, input_channels: int, output_channels: int, pool: bool = True) -> None:
        super().__init__()
        layers: list[nn.Module] = [
            nn.Conv2d(input_channels, output_channels, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(output_channels),
            nn.ReLU(inplace=True),
            nn.Conv2d(output_channels, output_channels, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(output_channels),
            nn.ReLU(inplace=True),
        ]
        if pool:
            layers.append(nn.MaxPool2d(kernel_size=2))
        self.layers = nn.Sequential(*layers)

    def forward(self, value: torch.Tensor) -> torch.Tensor:
        return self.layers(value)


class SmallSkinCNN(nn.Module):
    """Compact randomly initialized baseline intended for CPU research runs."""

    architecture_id = "medscope-small-cnn-v1"

    def __init__(self, number_of_classes: int) -> None:
        super().__init__()
        self.features = nn.Sequential(
            _ConvBlock(3, 24),
            _ConvBlock(24, 48),
            _ConvBlock(48, 96),
            _ConvBlock(96, 160),
            nn.AdaptiveAvgPool2d((1, 1)),
        )
        self.classifier = nn.Sequential(nn.Flatten(), nn.Dropout(p=0.35), nn.Linear(160, number_of_classes))

    def forward(self, image: torch.Tensor) -> torch.Tensor:
        return self.classifier(self.features(image))

