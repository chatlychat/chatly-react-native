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

import { readCanvas } from '../blocks/read-envelope';
import { useChatly } from '../useChatly';
import { MessageBlocks } from './MessageBlocks';

import type { CanvasField, WidgetCanvas } from '../blocks/types';

export interface MessageCanvasProps {
  /** The stored canvas, straight off the message row. Unvalidated. */
  readonly canvas: unknown;
  readonly conversationId: string | null;
  readonly messageId: string;
}

/** The value a field starts with, as a string the input can hold. */
function initialValue(field: CanvasField): string {
  if (field.type === 'checkbox') {
    return field.value === true ? 'true' : '';
  }
  return field.value ?? '';
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
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((initial?.fields ?? []).map((f) => [f.name, initialValue(f)])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  if (canvas === null) {
    return null;
  }

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
        // Checkboxes go as booleans; everything else as the string typed.
        values: Object.fromEntries(
          (canvas.fields ?? []).map((f) => [
            f.name,
            f.type === 'checkbox' ? values[f.name] === 'true' : (values[f.name] ?? ''),
          ]),
        ),
      })
      .then((answer) => {
        const next = readCanvas(answer.canvas);
        if (next !== null) {
          setCanvas(next);
          setValues(Object.fromEntries((next.fields ?? []).map((f) => [f.name, initialValue(f)])));
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

      {(canvas.fields ?? []).map((f) => (
        <View key={f.name} style={{ gap: 2 }}>
          <Text style={label}>{f.required === true ? `${f.label} *` : f.label}</Text>
          {f.type === 'checkbox' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={f.label}
              onPress={() =>
                setValues((v) => ({ ...v, [f.name]: v[f.name] === 'true' ? '' : 'true' }))
              }
            >
              <Text style={label}>{values[f.name] === 'true' ? 'Yes' : 'No'}</Text>
            </Pressable>
          ) : (
            <TextInput
              accessibilityLabel={f.label}
              value={values[f.name] ?? ''}
              placeholder={'placeholder' in f ? f.placeholder : undefined}
              editable={!busy}
              onChangeText={(text) => setValues((v) => ({ ...v, [f.name]: text }))}
              style={{
                borderWidth: 1,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.md,
                paddingHorizontal: theme.spacing.sm,
                paddingVertical: 6,
                color: theme.colors.foreground,
              }}
            />
          )}
          {errors[f.name] !== undefined && (
            <Text style={{ color: theme.colors.danger, fontSize: theme.typography.sizeSmall }}>
              {errors[f.name]}
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
              accessibilityLabel={a.label}
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
                {a.label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
