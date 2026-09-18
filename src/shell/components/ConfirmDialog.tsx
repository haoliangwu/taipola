/**
 * The app's one confirm dialog, replacing the browser's `window.confirm`
 * (`.scratch/confirm-dialog/issues/01`).
 *
 * Modal (`showModal`) on purpose: the native focus trap — focus lands inside
 * the dialog and Tab cannot leave it — and the `::backdrop` behind it. Ctrl:
 * the shell owns the state (a message plus the promise the answer resolves),
 * this component only renders it and reports the choice.
 */
import { useEffect, useRef } from 'react'

export interface ConfirmRequest {
  message: string
  resolve: (ok: boolean) => void
}

interface ConfirmDialogProps {
  /** The open request, or null when nothing is being asked. */
  request: ConfirmRequest | null
  /** The user answered: confirmed or declined. */
  onAnswer(ok: boolean): void
}

export function ConfirmDialog({ request, onAnswer }: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (dialog === null) return
    if (request !== null && !dialog.open) {
      // showModal needs a user gesture in some browsers; the request always
      // arrives from one (a click), so this is fine. `close()` after
      // `showModal()` on the same frame would throw — both paths guard on
      // `dialog.open`.
      dialog.showModal()
      dialog.querySelector<HTMLButtonElement>('.confirm-cancel')?.focus()
    } else if (request === null && dialog.open) {
      dialog.close()
    }
  }, [request])

  return (
    <dialog
      className="confirm-dialog"
      ref={ref}
      onCancel={(event) => {
        // Escape closes the dialog and nothing else: this element is inert to
        // the shell's keyboard shortcuts while it is modal, so the editor stays
        // focused and unblurred. The default cancel would close the dialog
        // behind the state's back — prevent it, the non-null request chooses.
        event.preventDefault()
        onAnswer(false)
      }}
    >
      <p className="confirm-message">{request?.message ?? ''}</p>
      <div className="confirm-actions">
        <button type="button" className="confirm-cancel" onClick={() => onAnswer(false)}>
          取消
        </button>
        <button type="button" className="confirm-ok" onClick={() => onAnswer(true)}>
          确定
        </button>
      </div>
    </dialog>
  )
}