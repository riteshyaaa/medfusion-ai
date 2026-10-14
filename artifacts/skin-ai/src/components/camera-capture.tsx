import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, X, RefreshCw, Zap, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface CameraCaptureProps {
  onCapture: (file: File) => void;
  onClose: () => void;
}

type CameraState = "requesting" | "live" | "captured" | "error";

export function CameraCapture({ onCapture, onClose }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [state, setState] = useState<CameraState>("requesting");
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");
  const [flash, setFlash] = useState(false);

  const startCamera = useCallback(async (facing: "user" | "environment") => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setState("requesting");
    setCapturedUrl(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setState("live");
    } catch (err: unknown) {
      const msg =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Camera permission denied. Please allow camera access in your browser settings."
          : err instanceof DOMException && err.name === "NotFoundError"
          ? "No camera found on this device."
          : "Unable to access the camera. Please try again.";
      setErrorMsg(msg);
      setState("error");
    }
  }, []);

  useEffect(() => {
    startCamera(facingMode);
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const handleCapture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (facingMode === "user") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    setFlash(true);
    setTimeout(() => setFlash(false), 350);

    const url = canvas.toDataURL("image/jpeg", 0.92);
    setCapturedUrl(url);
    setState("captured");

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const handleRetake = () => {
    setCapturedUrl(null);
    startCamera(facingMode);
  };

  const handleFlipCamera = () => {
    const next = facingMode === "environment" ? "user" : "environment";
    setFacingMode(next);
    startCamera(next);
  };

  const handleUsePhoto = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `camera-capture-${Date.now()}.jpg`, {
          type: "image/jpeg",
        });
        onCapture(file);
        onClose();
      },
      "image/jpeg",
      0.92
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.92, opacity: 0 }}
        transition={{ type: "spring", stiffness: 340, damping: 28 }}
        className="relative bg-slate-900 rounded-3xl overflow-hidden shadow-2xl w-full max-w-lg"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/60">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-teal-500/20 flex items-center justify-center">
              <Camera className="w-4 h-4 text-teal-400" />
            </div>
            <span className="font-display font-semibold text-white text-sm">Live Camera Capture</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Camera viewport */}
        <div className="relative bg-black aspect-[4/3] overflow-hidden">
          {/* Live video — mirrored for front camera */}
          <video
            ref={videoRef}
            playsInline
            muted
            className={cn(
              "absolute inset-0 w-full h-full object-cover transition-opacity duration-300",
              state === "live" ? "opacity-100" : "opacity-0",
              facingMode === "user" ? "-scale-x-100" : ""
            )}
          />

          {/* Captured still */}
          <AnimatePresence>
            {capturedUrl && state === "captured" && (
              <motion.img
                key="captured"
                src={capturedUrl}
                alt="Captured"
                initial={{ opacity: 0, scale: 1.04 }}
                animate={{ opacity: 1, scale: 1 }}
                className="absolute inset-0 w-full h-full object-cover"
              />
            )}
          </AnimatePresence>

          {/* Flash effect */}
          <AnimatePresence>
            {flash && (
              <motion.div
                key="flash"
                initial={{ opacity: 0.9 }}
                animate={{ opacity: 0 }}
                transition={{ duration: 0.35 }}
                className="absolute inset-0 bg-white z-30 pointer-events-none"
              />
            )}
          </AnimatePresence>

          {/* Loading/error overlays */}
          <AnimatePresence>
            {state === "requesting" && (
              <motion.div
                key="requesting"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 z-20"
              >
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
                  className="w-10 h-10 border-2 border-teal-400 border-t-transparent rounded-full mb-3"
                />
                <p className="text-slate-400 text-sm">Starting camera…</p>
              </motion.div>
            )}

            {state === "error" && (
              <motion.div
                key="error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 z-20 p-6 text-center"
              >
                <div className="w-14 h-14 rounded-full bg-red-500/15 flex items-center justify-center mb-4">
                  <AlertCircle className="w-7 h-7 text-red-400" />
                </div>
                <p className="text-white font-semibold mb-2">Camera Unavailable</p>
                <p className="text-slate-400 text-sm leading-relaxed">{errorMsg}</p>
                <button
                  onClick={() => startCamera(facingMode)}
                  className="mt-5 px-4 py-2 text-sm font-medium text-teal-400 border border-teal-500/40 rounded-full hover:bg-teal-500/10 transition-colors"
                >
                  Try Again
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Viewfinder grid overlay */}
          {state === "live" && (
            <div className="absolute inset-0 pointer-events-none z-10">
              <div className="absolute inset-[20%] border border-white/10 rounded-lg" />
              <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
                {Array.from({ length: 9 }).map((_, i) => (
                  <div key={i} className="border border-white/5" />
                ))}
              </div>
            </div>
          )}

          {/* Flip camera button */}
          {(state === "live" || state === "requesting") && (
            <button
              onClick={handleFlipCamera}
              className="absolute top-3 right-3 z-20 p-2 rounded-full bg-black/40 text-white hover:bg-black/60 backdrop-blur-sm transition-colors"
              title="Flip camera"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Hidden canvas for capture */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Controls */}
        <div className="px-5 py-5 flex items-center justify-between bg-slate-900">
          {state === "live" ? (
            <>
              <p className="text-slate-500 text-xs">Position skin clearly in view</p>
              <button
                onClick={handleCapture}
                className="relative w-16 h-16 rounded-full bg-white flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-transform"
                title="Take photo"
              >
                <div className="w-12 h-12 rounded-full border-2 border-slate-300 flex items-center justify-center">
                  <Zap className="w-5 h-5 text-slate-700" />
                </div>
              </button>
              <div className="w-[120px]" />
            </>
          ) : state === "captured" ? (
            <>
              <button
                onClick={handleRetake}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-300 border border-slate-600 rounded-full hover:bg-slate-700 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Retake
              </button>
              <button
                onClick={handleUsePhoto}
                className="flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-white bg-teal-500 hover:bg-teal-400 rounded-full shadow-lg shadow-teal-500/30 transition-colors"
              >
                <Camera className="w-4 h-4" />
                Analyze This Photo
              </button>
            </>
          ) : (
            <div className="w-full" />
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
