import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after user confirms preview (same File object). */
  onConfirm: (file: File) => void;
};

export function CameraCapture({ open, onOpenChange, onConfirm }: Props) {
  const galleryId = useId();
  const galleryRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  /** Live webcam UI (desktop); mobile file+capture is unreliable without this too. */
  const [cameraLive, setCameraLive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraLive(false);
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const reset = useCallback(() => {
    stopStream();
    setCameraError(null);
    setPreviewUrl((u) => {
      if (u) URL.revokeObjectURL(u);
      return null;
    });
    setFile(null);
    if (galleryRef.current) galleryRef.current.value = '';
  }, [stopStream]);

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const onPicked = (f: File | null) => {
    if (!f) return;
    stopStream();
    setCameraError(null);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(f);
    });
    setFile(f);
  };

  async function startLiveCamera() {
    setCameraError(null);
    stopStream();
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setFile(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('This browser does not support camera access. Use Upload file instead.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraLive(true);
      requestAnimationFrame(() => {
        const el = videoRef.current;
        if (el) {
          el.srcObject = stream;
          void el.play().catch(() => {});
        }
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCameraError(
        msg.includes('Permission') || msg.includes('NotAllowed')
          ? 'Camera permission denied. Allow camera for localhost in the browser address bar, or use Upload file.'
          : `Could not open camera: ${msg}. Try Upload file.`
      );
    }
  }

  function captureFrameToFile() {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;

    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const name = `invoice-scan-${Date.now()}.jpg`;
        const f = new File([blob], name, { type: 'image/jpeg' });
        stopStream();
        onPicked(f);
      },
      'image/jpeg',
      0.92
    );
  }

  /** Mobile fallback: OS may still open camera when capture is set. Must be in the DOM for some browsers. */
  function openNativeCameraPicker() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;width:1px;height:1px;';
    const cleanup = () => {
      input.remove();
    };
    input.addEventListener('change', () => {
      const f = input.files?.[0] ?? null;
      onPicked(f);
      cleanup();
    });
    input.addEventListener('cancel', cleanup);
    document.body.appendChild(input);
    input.click();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Capture or upload invoice</DialogTitle>
          <DialogDescription>
            <strong>Take photo</strong> opens your webcam on desktop (browser will ask permission). On some phones you
            can use <strong>Upload file</strong> or the fallback below if the live camera is not available.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <input
            ref={galleryRef}
            id={galleryId}
            type="file"
            accept="image/*,.pdf,application/pdf"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              onPicked(f);
            }}
          />

          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="default" className="w-full" onClick={() => void startLiveCamera()}>
              Take photo
            </Button>
            <Button type="button" variant="outline" className="w-full" onClick={() => galleryRef.current?.click()}>
              Upload file
            </Button>
          </div>

          <Button type="button" variant="secondary" size="sm" className="w-full text-xs" onClick={openNativeCameraPicker}>
            Use phone-style camera picker (fallback)
          </Button>

          {cameraError && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">{cameraError}</p>
          )}

          {cameraLive && (
            <div className="space-y-2 rounded-md border bg-black/5 p-2">
              <video ref={videoRef} autoPlay playsInline muted className="max-h-56 w-full rounded object-contain bg-black" />
              <div className="flex gap-2">
                <Button type="button" size="sm" className="flex-1" onClick={captureFrameToFile}>
                  Capture snapshot
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={stopStream}>
                  Close camera
                </Button>
              </div>
            </div>
          )}

          {previewUrl && file && !cameraLive && (
            <div className="rounded-md border bg-muted/40 p-2">
              <p className="mb-2 truncate text-xs text-muted-foreground">{file.name}</p>
              {file.type.startsWith('image/') ? (
                <img src={previewUrl} alt="Preview" className="max-h-48 w-full rounded object-contain" />
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">PDF selected — preview not shown.</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!file}
            onClick={() => {
              if (!file) return;
              onConfirm(file);
              handleOpenChange(false);
            }}
          >
            Use this file
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
