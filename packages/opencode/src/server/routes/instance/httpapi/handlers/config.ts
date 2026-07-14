import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"
import { EffectBridge } from "@/effect/bridge"

export const configHandlers = HttpApiBuilder.group(InstanceHttpApi, "config", (handlers) =>
  Effect.gen(function* () {
    const providerSvc = yield* Provider.Service
    const configSvc = yield* Config.Service
    const bridge = yield* EffectBridge.make()

    const get = Effect.fn("ConfigHttpApi.get")(function* () {
      return yield* configSvc.get()
    })

    const update = Effect.fn("ConfigHttpApi.update")(function* (ctx) {
      yield* configSvc.update(ctx.payload)
      // Provider models are cached per instance at boot; dispose all so every
      // directory reloads config (including CONFIG_DIR / runtimeOverrides).
      bridge.fork(disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true }))
      return ctx.payload
    })

    const providers = Effect.fn("ConfigHttpApi.providers")(function* () {
      const providers = yield* providerSvc.list()
      return {
        providers: Object.values(providers).map(Provider.toPublicInfo),
        default: Provider.defaultModelIDs(providers),
      }
    })

    return handlers.handle("get", get).handle("update", update).handle("providers", providers)
  }),
)
