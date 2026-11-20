// A text another program printed, as the pane may draw it (T4742). What `teamrig read` serves is data: a title, a
// note or an inbox line holds whatever its writer typed, and JSON carries every character but the C0 controls as it
// is. Drawn raw, an escape would restyle or move the terminal's cursor, and a direction mark would show a line's
// words in another order than they are stored, so a row could read as something it does not say. So every text a
// document's reader hands a view passes here first (document-fields.ts), team text as much as an outside author's: a
// control character (C0, DEL, C1) draws as `�`, where a reader sees something was there, and a direction mark is
// dropped, since it draws as nothing and a text in a right-to-left script still orders itself without one. A line
// break stays: a description is written in lines, and a break moves no cursor the pane's own layout does not place.
// A tab draws as one space, its width in a terminal being the terminal's choice. Pure.

/** A line break as Windows writes it. */
const CRLF = /\r\n/g
/** The marks that set or override the direction a run of text is drawn in (Unicode's Bidi_Control). */
const DIRECTION_MARK = /\p{Bidi_Control}/gu
/** Every control character but the line break. */
const CONTROL = /[^\P{Cc}\n]/gu
/** What a control character draws as. */
export const CONTROL_SHOWN = '�'

/** `text` with nothing in it a terminal would act on. */
export function shownText(text: string): string {
  return text.replace(CRLF, '\n').replaceAll('\t', ' ').replace(DIRECTION_MARK, '').replace(CONTROL, CONTROL_SHOWN)
}
