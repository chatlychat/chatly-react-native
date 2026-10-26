/**
 * A Tier 2 canvas on a native screen — a form inside a message bubble.
 *
 * ── What it is for ────────────────────────────────────────────────────
 *
 * A confirm step: the total is quoted, the shopper confirms, the server
 * re-quotes and refuses if it moved. The price guard is the server-held
 * `state`, which is why submission goes back through the API rather than
 * being resolved here.
 *
 * ── Two properties worth stating ──────────────────────────────────────
 *
 * The canvas on screen is REPLACED by whatever the submission returns, not
 * merged. A refused submission comes back as the same canvas with messages on
 * it, and a changed total comes back as a FRESH step rather than a charge —
 * so a renderer that kept its own copy would show the shopper the old price
 * next to the new errors.
 *
 * A `hostEvent` on the answer is handed to the app. That is how 3-D Secure
 * works on a phone: the step's answer says "now run this", the app runs it
 * natively, and nothing in this library has to know what Stripe is.
 *
 * ── Tier 3 is deliberately not rendered ───────────────────────────────
 *
 * An `app` canvas is an integrator's own page in a sandboxed iframe, and
 * there is no React Native equivalent of a sandbox attribute — an app frame
 * here would be a WebView, which is the thing a native SDK exists to avoid.
 * The title and a one-line explanation are shown instead, and the integrator
 * can present it natively if they want to.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { MessageBlocks } from './MessageBlocks';
import { computeCanvasTotal, visibleInputIds } from '../blocks/canvas-total';
import { formatMoney } from '../blocks/money';
import { readCanvas } from '../blocks/read-canvas';
import { useChatly } from '../useChatly';

import type { WidgetCanvas } from '../blocks/types';

export interface MessageCanvasProps {
  /** The stored canvas, straight off the message row. Unvalidated. */
  readonly canvas: unknown;
  readonly conversationId: string | null;
  readonly messageId: string;
}

type Values = Record<string, string | boolean>;

/** The value a field starts with: a toggle holds a boolean, everything else the string typed. */
function initialValues(canvas: WidgetCanvas | null): Values {
  return Object.fromEntries(
    (canvas?.inputs ?? []).map((f) => [
      f.id,
      f.type === 'toggle' ? f.value === true : (f.value ?? ''),
    ]),
  );
}

export function MessageCanvas(props: MessageCanvasProps): React.JSX.Element | null {
  const { theme, rest, onAction } = useChatly();
  const initial = useMemo(() => readCanvas(props.canvas), [props.canvas]);
  /**
   * The canvas is STATE, seeded from the prop.
   *
   * A submission returns the next canvas — or the same one with errors — and
   * that answer has to win over the message row this component was handed,
   * because the row only catches up when the realtime `message.updated`
   * arrives. Rendering the prop would flash the pre-submission step back onto
   * the screen in between.
   */
  const [canvas, setCanvas] = useState<WidgetCanvas | null>(initial);
  const [values, setValues] = useState<Values>(() => initialValues(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  if (canvas === null) {
    return null;
  }
  const inputs = canvas.inputs ?? [];
  // The same visibility rule the server validates with: a hidden input is not
  // drawn, not submitted, and not summed into the total.
  const visible = visibleInputIds(inputs, values);
  const total = computeCanvasTotal(canvas, values);

  const submit = (actionId: string, kind: 'submit' | 'cancel'): void => {
    const conversationId = props.conversationId;
    if (conversationId === null || busy) {
      return;
    }
    setBusy(true);
    void rest
      .submitCanvas(conversationId, {
        messageId: props.messageId,
        actionId,
        // Toggles go as booleans; everything else as the string typed. A
        // hidden input is left out, as on the web.
        values: Object.fromEntries(
          inputs.filter((f) => visible.has(f.id)).map((f) => [f.id, values[f.id] ?? '']),
        ),
      })
      .then((answer) => {
        const next = readCanvas(answer.canvas);
        if (next !== null) {
          setCanvas(next);
          setValues(initialValues(next));
        }
        setErrors(answer.errors);
        const hostEvent = answer.hostEvent as
          | { event?: string; data?: Record<string, unknown> }
          | undefined;
        if (hostEvent?.event !== undefined) {
          // 3-D Secure, a native screen, whatever the integrator needs. The
          // step asked; the app does it.
          onAction?.({
            event: hostEvent.event,
            data: hostEvent.data ?? {},
            conversationId,
            messageId: props.messageId,
            actionId,
          });
        }
      })
      .catch(() => {
        // A failed submit must leave the form usable. The shopper can retry,
        // and the server is the only thing that can settle the price.
        setErrors({ _: 'That did not go through. Try again.' });
      })
      .finally(() => setBusy(false));
    if (kind === 'cancel') {
      setErrors({});
    }
  };

  const label = { color: theme.colors.foreground, fontSize: theme.typography.sizeSmall };

  return (
    <View
      accessibilityLabel={canvas.title ?? 'Step'}
      style={{
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: theme.radius.bubble,
        backgroundColor: theme.colors.surface,
        padding: theme.spacing.sm,
        marginTop: 6,
        gap: 6,
      }}
    >
      {canvas.title !== undefined && (
        <Text style={{ color: theme.colors.foreground, fontSize: theme.typography.sizeTitle }}>
          {canvas.title}
        </Text>
      )}

      {canvas.blocks !== undefined && canvas.blocks.length > 0 && (
        <MessageBlocks
          blocks={{ v: 1, blocks: canvas.blocks }}
          conversationId={props.conversationId}
          messageId={props.messageId}
        />
      )}

      {canvas.app !== undefined && (
        <Text style={{ color: theme.colors.mutedForeground, fontSize: theme.typography.sizeSmall }}>
          {`${canvas.app.title ?? 'This step'} opens outside the chat.`}
        </Text>
      )}

      {inputs
        .filter((f) => visible.has(f.id))
        .map((f) => (
          <View key={f.id} style={{ gap: 2 }}>
            <Text style={label}>
              {'required' in f && f.required === true ? `${f.label} *` : f.label}
            </Text>
            {f.type === 'toggle' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={f.label}
                onPress={() => setValues((v) => ({ ...v, [f.id]: v[f.id] !== true }))}
              >
                <Text style={label}>{values[f.id] === true ? 'Yes' : 'No'}</Text>
              </Pressable>
            ) : f.type === 'select' ? (
              <View style={{ gap: 4 }}>
                {f.options.map((o) => {
                  const text =
                    o.adds === undefined ? o.label : `${o.label} (+${formatMoney(o.adds)})`;
                  return (
                    <Pressable
                      key={o.value}
                      accessibilityRole="button"
                      accessibilityLabel={text}
                      accessibilityState={{ selected: values[f.id] === o.value }}
                      disabled={busy}
                      onPress={() => setValues((v) => ({ ...v, [f.id]: o.value }))}
                    >
                      <Text
                        style={label}
                      >{`${values[f.id] === o.value ? '(•)' : '( )'} ${text}`}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <TextInput
                accessibilityLabel={f.label}
                value={String(values[f.id] ?? '')}
                placeholder={f.placeholder}
                editable={!busy}
                multiline={f.type === 'textarea'}
                keyboardType={
                  f.type === 'number'
                    ? 'numeric'
                    : f.type === 'email'
                      ? 'email-address'
                      : f.type === 'tel'
                        ? 'phone-pad'
                        : 'default'
                }
                onChangeText={(text) => setValues((v) => ({ ...v, [f.id]: text }))}
                style={{
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  borderRadius: theme.radius.md,
                  paddingHorizontal: theme.spacing.sm,
                  paddingVertical: 6,
                  minHeight: f.type === 'textarea' ? 72 : undefined,
                  color: theme.colors.foreground,
                }}
              />
            )}
            {errors[f.id] !== undefined && (
              <Text style={{ color: theme.colors.danger, fontSize: theme.typography.sizeSmall }}>
                {errors[f.id]}
              </Text>
            )}
          </View>
        ))}

      {errors['_'] !== undefined && (
        <Text style={{ color: theme.colors.danger, fontSize: theme.typography.sizeSmall }}>
          {errors['_']}
        </Text>
      )}

      {(canvas.actions ?? []).length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {(canvas.actions ?? []).map((a) => (
            <Pressable
              key={a.id}
              accessibilityRole="button"
              accessibilityLabel={
                a.showTotal === true && a.kind === 'submit' && total !== null
                  ? `${a.label} · ${formatMoney(total)}`
                  : a.label
              }
              disabled={busy}
              onPress={() => submit(a.id, a.kind)}
              style={{
                borderRadius: theme.radius.md,
                paddingHorizontal: theme.spacing.md,
                paddingVertical: theme.spacing.sm,
                backgroundColor:
                  a.style === 'primary'
                    ? theme.colors.primary
                    : a.style === 'danger'
                      ? theme.colors.danger
                      : theme.colors.surface,
                borderColor: theme.colors.border,
                borderWidth: a.style === undefined || a.style === 'secondary' ? 1 : 0,
                opacity: busy ? 0.6 : 1,
              }}
            >
              <Text
                style={{
                  color:
                    a.style === 'primary' || a.style === 'danger'
                      ? theme.colors.onPrimary
                      : theme.colors.foreground,
                  fontSize: theme.typography.sizeBody,
                }}
              >
                {a.showTotal === true && a.kind === 'submit' && total !== null
                  ? `${a.label} · ${formatMoney(total)}`
                  : a.label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
