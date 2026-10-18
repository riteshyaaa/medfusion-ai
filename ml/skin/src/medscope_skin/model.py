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


class TransferSkinModel(nn.Module):
    """MobileNetV2 transfer-learning model (ImageNet-pretrained backbone)."""

    architecture_id = "medscope-mobilenetv2-v1"

    def __init__(self, number_of_classes: int, pretrained: bool = True) -> None:
        super().__init__()
        try:
            import torchvision
        except ImportError as error:  # pragma: no cover - environment issue surfaced clearly
            raise RuntimeError("The medscope-mobilenetv2-v1 architecture requires torchvision in the ML environment.") from error
        weights = torchvision.models.MobileNet_V2_Weights.IMAGENET1K_V1 if pretrained else None
        backbone = torchvision.models.mobilenet_v2(weights=weights)
        self.features = backbone.features
        self.pool = nn.AdaptiveAvgPool2d((1, 1))
        self.classifier = nn.Sequential(nn.Flatten(), nn.Dropout(p=0.3), nn.Linear(1280, number_of_classes))

    def forward(self, image: torch.Tensor) -> torch.Tensor:
        return self.classifier(self.pool(self.features(image)))


class EfficientNetSkinModel(nn.Module):
    """EfficientNet-B0 transfer-learning model (ImageNet-pretrained backbone)."""

    architecture_id = "medscope-efficientnet-v1"

    def __init__(self, number_of_classes: int, pretrained: bool = True) -> None:
        super().__init__()
        try:
            import torchvision
        except ImportError as error:  # pragma: no cover - environment issue surfaced clearly
            raise RuntimeError("The medscope-efficientnet-v1 architecture requires torchvision in the ML environment.") from error
        weights = torchvision.models.EfficientNet_B0_Weights.IMAGENET1K_V1 if pretrained else None
        backbone = torchvision.models.efficientnet_b0(weights=weights)
        self.features = backbone.features
        self.pool = nn.AdaptiveAvgPool2d((1, 1))
        self.classifier = nn.Sequential(nn.Flatten(), nn.Dropout(p=0.3), nn.Linear(1280, number_of_classes))

    def forward(self, image: torch.Tensor) -> torch.Tensor:
        return self.classifier(self.pool(self.features(image)))


SUPPORTED_ARCHITECTURES = (SmallSkinCNN.architecture_id, TransferSkinModel.architecture_id, EfficientNetSkinModel.architecture_id)


def create_skin_model(architecture_id: str, number_of_classes: int, pretrained: bool) -> nn.Module:
    if architecture_id == SmallSkinCNN.architecture_id:
        if pretrained:
            raise ValueError("SmallSkinCNN is a randomly initialized architecture and cannot use pretrained weights.")
        return SmallSkinCNN(number_of_classes)
    if architecture_id == TransferSkinModel.architecture_id:
        return TransferSkinModel(number_of_classes, pretrained=pretrained)
    if architecture_id == EfficientNetSkinModel.architecture_id:
        return EfficientNetSkinModel(number_of_classes, pretrained=pretrained)
    raise ValueError(f"Unsupported skin model architecture: {architecture_id!r}")

