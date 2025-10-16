import React from "react";

interface InputDialogProps {
  open: boolean;
  title: string;
  message?: string;
  value: string;
  onChange: (value: string) => void;
  inputType?: React.HTMLInputTypeAttribute;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
  error?: string;
  children?: React.ReactNode;
}

const InputDialog: React.FC<InputDialogProps> = ({
  open,
  title,
  message,
  value,
  onChange,
  inputType = "text",
  placeholder,
  confirmText = "OK",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
  loading = false,
  error,
  children,
}) => {
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (open) {
      // slight delay to ensure element is mounted
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [open]);

  if (!open) return null;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!loading) {
      onConfirm();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 1000,
      }}
      onClick={onCancel}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 420,
          background: "var(--app-bg)",
          color: "var(--app-text)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          padding: 18,
          boxShadow: "0 18px 36px rgba(0,0,0,0.16)",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 600 }}>{title}</div>
        {message && (
          <div style={{ fontSize: 14, color: "var(--muted-text)" }}>{message}</div>
        )}
        <input
          ref={inputRef}
          type={inputType}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          style={{
            width: "100%",
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid var(--input-border)",
            background: "var(--card-bg)",
            color: "var(--app-text)",
            boxShadow: "none",
          }}
          disabled={loading}
        />
        {children}
        {error && (
          <div style={{ color: "#ef4444", fontSize: 13 }}>{error}</div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
          <button
            type="button"
            className="soft-btn"
            style={{
              borderRadius: 12,
              padding: "10px 14px",
              background: "#a9b1bbff",
              color: "#fff",
            }}
            onClick={onCancel}
            disabled={loading}
          >
            {cancelText}
          </button>
          <button
            type="submit"
            style={{
              borderRadius: 12,
              padding: "10px 18px",
              minWidth: 110,
              background: loading
                ? "linear-gradient(90deg, #9ca3af 0%, #d1d5db 100%)"
                : "linear-gradient(90deg, #6366f1 0%, #6c5ce7 100%)",
              color: "#fff",
              border: "none",
              boxShadow: "0 6px 16px rgba(99, 102, 241, 0.22)",
              opacity: loading ? 0.85 : 1,
              cursor: loading ? "progress" : "pointer",
            }}
            disabled={loading}
          >
            {confirmText}
          </button>
        </div>
      </form>
    </div>
  );
};

export default InputDialog;
