export interface ComposerShortcutEvent {
  key: string;
  shiftKey?: boolean;
  nativeEvent?: {
    isComposing?: boolean;
  };
}

export function shouldSubmitComposerShortcut(event: ComposerShortcutEvent) {
  return event.key === "Enter" && !event.shiftKey && !event.nativeEvent?.isComposing;
}
