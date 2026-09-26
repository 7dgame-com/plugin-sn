interface HostEventMessage {
  type: 'EVENT'
  id: string
  payload: {
    event: string
    pluginUrl?: string
    [key: string]: unknown
  }
}

function createMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function postHostEvent(payload: HostEventMessage['payload']): void {
  window.parent.postMessage(
    {
      type: 'EVENT',
      id: createMessageId(),
      payload,
    },
    '*',
  )
}

export function notifyHostPluginUrlChanged(pluginUrl: string): void {
  postHostEvent({
    event: 'plugin-url-changed',
    pluginUrl,
  })
}
