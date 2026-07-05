/* eslint-env node */
/* global fetch, console, URL, setTimeout */

import process from "node:process"

const DEFAULT_BASE_URL = "http://127.0.0.1:4099"
const DEFAULT_DIRECTORY = process.cwd()
const WAIT_TIMEOUT_MS = 30000
const POLL_INTERVAL_MS = 1000
const PROMPT = [
  "Return only schema-conforming structured output.",
  "You must capture the result through the StructuredOutput flow.",
  "Set ok=true.",
  "Set answer='pong'.",
  "Set items=['a','b'].",
].join(" ")

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    ok: { type: "boolean" },
    answer: { type: "string" },
    items: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["ok", "answer", "items"],
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function tryParseJsonText(text) {
  const trimmed = String(text ?? "").trim()
  if (!trimmed) return undefined
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  const candidate = fenced?.[1]?.trim() ?? trimmed
  if (!(candidate.startsWith("{") || candidate.startsWith("["))) return undefined
  try {
    return JSON.parse(candidate)
  } catch {
    return undefined
  }
}

function readStructured(message) {
  for (const part of message?.parts ?? []) {
    if (part?.type === "tool" && part.tool === "StructuredOutput") {
      if (isRecord(part?.state?.input) && Object.keys(part.state.input).length > 0) return part.state.input
      if (isRecord(part?.state?.structured) && Object.keys(part.state.structured).length > 0) return part.state.structured
      if (isRecord(part?.state?.result) && Object.keys(part.state.result).length > 0) return part.state.result
      if (typeof part?.state?.output === "string") {
        const parsed = tryParseJsonText(part.state.output)
        if (parsed !== undefined) return parsed
      }
    }
    if (part?.type === "text" && typeof part.text === "string") {
      const parsed = tryParseJsonText(part.text)
      if (parsed !== undefined) return parsed
    }
  }
  return (
    message?.structured ??
    message?.info?.structured ??
    message?.data?.structured ??
    message?.data?.info?.structured ??
    message?.info?.structured_output ??
    message?.data?.info?.structured_output
  )
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options)
  const text = await response.text()
  let body
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return {
    ok: response.ok,
    status: response.status,
    url: url.toString(),
    body,
  }
}

async function main() {
  const baseUrl = process.env.OPENCODE_SERVER_URL || DEFAULT_BASE_URL
  const directory = process.env.OPENCODE_DIRECTORY || DEFAULT_DIRECTORY
  const headers = {
    "content-type": "application/json",
    "x-opencode-directory": directory,
  }

  const createResponse = await fetchJson(new URL("/session", baseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify({ title: "structured-output-v1-messages-smoke" }),
  })
  if (!createResponse.ok) {
    throw new Error(`session create failed: HTTP ${createResponse.status} ${JSON.stringify(createResponse.body)}`)
  }

  const sessionId = createResponse.body?.id ?? createResponse.body?.data?.id
  if (!sessionId) {
    throw new Error(`session create did not return an id: ${JSON.stringify(createResponse.body)}`)
  }

  const promptResponse = await fetchJson(new URL(`/session/${sessionId}/prompt_async`, baseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify({
      parts: [{ type: "text", text: PROMPT }],
      format: {
        type: "json_schema",
        schema: JSON_SCHEMA,
        retryCount: 2,
      },
    }),
  })
  if (!promptResponse.ok) {
    throw new Error(`prompt_async failed: HTTP ${promptResponse.status} ${JSON.stringify(promptResponse.body)}`)
  }

  const startedAt = Date.now()
  let lastMessagesResponse
  while (Date.now() - startedAt < WAIT_TIMEOUT_MS) {
    lastMessagesResponse = await fetchJson(new URL(`/session/${sessionId}/message`, baseUrl), {
      headers: { "x-opencode-directory": directory },
    })
    if (!lastMessagesResponse.ok) {
      throw new Error(
        `session.messages failed: HTTP ${lastMessagesResponse.status} ${JSON.stringify(lastMessagesResponse.body)}`,
      )
    }

    const messages = Array.isArray(lastMessagesResponse.body) ? lastMessagesResponse.body : []
    const userMessage = messages.find((message) => message?.info?.role === "user")
    const assistantMessage = [...messages].reverse().find((message) => message?.info?.role === "assistant")
    const structured = assistantMessage ? readStructured(assistantMessage) : undefined

    if (userMessage?.info?.format && structured !== undefined) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            baseUrl,
            directory,
            sessionId,
            createResponse,
            promptResponse: {
              status: promptResponse.status,
              url: promptResponse.url,
            },
            messagesResponse: {
              status: lastMessagesResponse.status,
              url: lastMessagesResponse.url,
              count: messages.length,
            },
            userFormat: userMessage.info.format,
            assistant: {
              id: assistantMessage?.info?.id ?? null,
              finish: assistantMessage?.info?.finish ?? null,
              structured,
            },
          },
          null,
          2,
        ),
      )
      return
    }

    await sleep(POLL_INTERVAL_MS)
  }

  throw new Error(`timed out waiting for assistant structured output: ${JSON.stringify(lastMessagesResponse?.body)}`)
}

await main().catch((error) => {
  console.log(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null,
      },
      null,
      2,
    ),
  )
  process.exitCode = 1
})
