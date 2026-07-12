import { useEffect, useRef, useState } from "react";

/** Records a short voice note and hands back a File the AI path can extract. */
export default function VoiceRecorder({ onRecorded }: { onRecorded: (file: File) => void }) {
    const [recording, setRecording] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const [error, setError] = useState("");
    const recorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);

    useEffect(() => {
        if (!recording) return;
        const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
        return () => clearInterval(timer);
    }, [recording]);

    // Stop tracks if the user navigates away mid-recording.
    useEffect(() => {
        return () => {
            recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
        };
    }, []);

    async function start() {
        setError("");
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const recorder = new MediaRecorder(stream);
            chunksRef.current = [];
            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };
            recorder.onstop = () => {
                stream.getTracks().forEach((t) => t.stop());
                const type = recorder.mimeType || "audio/webm";
                const blob = new Blob(chunksRef.current, { type });
                // Strip codec params: Gemini wants a plain mime type.
                const mime = type.split(";")[0];
                const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : "webm";
                onRecorded(
                    new File([blob], `voice-note-${Date.now()}.${ext}`, { type: mime }),
                );
            };
            recorder.start();
            recorderRef.current = recorder;
            setElapsed(0);
            setRecording(true);
        } catch {
            setError("Microphone unavailable or permission denied.");
        }
    }

    function stop() {
        recorderRef.current?.stop();
        recorderRef.current = null;
        setRecording(false);
    }

    return (
        <span className="flex items-center gap-2">
            <button
                type="button"
                onClick={recording ? stop : start}
                className={`rounded-lg px-3 py-2 text-sm ${
                    recording
                        ? "bg-rose-600 text-white hover:bg-rose-500"
                        : "bg-slate-800 text-slate-200 hover:bg-slate-700"
                }`}
            >
                {recording ? `■ Stop (${elapsed}s)` : "🎙 Record"}
            </button>
            {error && <span className="text-xs text-rose-400">{error}</span>}
        </span>
    );
}
