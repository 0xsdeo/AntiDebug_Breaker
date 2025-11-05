(function () {
    'use strict';

    const COLOR = {
        log: '#1475b2',
        info: '#606060',
        error: '#42b883',
    };
    const message = ({ type, params }) => {
        const LOG_MARK = [
            '%c vue-force-dev',
            `padding: 1px; border-radius: 0 3px 3px 0; color: #fff; background:${COLOR[type]}`,
        ];
        console[type](...LOG_MARK, ...params, '\n\nreport issues: https://github.com/hzmming/vue-force-dev/issues');
    };
    function error(...params) {
        message({ type: 'error', params });
    }

    const VUE_DEVTOOLS_MESSAGE_KEY = '__VUE_DEVTOOLS_VUE_DETECTED_EVENT__';
    // The key used by devtools v6 will be removed in the future
    const LEGACY_VUE_DEVTOOLS_MESSAGE_KEY = '_vue-devtools-send-message';

    const unpackVueDevtoolsMessage = (data) => VUE_DEVTOOLS_MESSAGE_KEY === data.key
        ? data.data
        : LEGACY_VUE_DEVTOOLS_MESSAGE_KEY === data.key
            ? data.message
            : data;

    /**
    * @vue/shared v3.4.21
    * (c) 2018-present Yuxi (Evan) You and Vue contributors
    * @license MIT
    **/

    const EMPTY_OBJ = {};
    const NOOP = () => {
    };
    const isArray = Array.isArray;
    const isMap = (val) => toTypeString(val) === "[object Map]";
    const isSet = (val) => toTypeString(val) === "[object Set]";
    const isFunction = (val) => typeof val === "function";
    const isSymbol = (val) => typeof val === "symbol";
    const isObject = (val) => val !== null && typeof val === "object";
    const isPromise = (val) => {
      return (isObject(val) || isFunction(val)) && isFunction(val.then) && isFunction(val.catch);
    };
    const objectToString = Object.prototype.toString;
    const toTypeString = (value) => objectToString.call(value);
    const isPlainObject = (val) => toTypeString(val) === "[object Object]";
    const hasChanged = (value, oldValue) => !Object.is(value, oldValue);
    const def = (obj, key, value) => {
      Object.defineProperty(obj, key, {
        configurable: true,
        enumerable: false,
        value
      });
    };
    let _globalThis;
    const getGlobalThis = () => {
      return _globalThis || (_globalThis = typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : {});
    };

    /**
    * @vue/reactivity v3.4.21
    * (c) 2018-present Yuxi (Evan) You and Vue contributors
    * @license MIT
    **/

    let activeEffectScope;
    function recordEffectScope(effect, scope = activeEffectScope) {
      if (scope && scope.active) {
        scope.effects.push(effect);
      }
    }

    let activeEffect;
    class ReactiveEffect {
      constructor(fn, trigger, scheduler, scope) {
        this.fn = fn;
        this.trigger = trigger;
        this.scheduler = scheduler;
        this.active = true;
        this.deps = [];
        /**
         * @internal
         */
        this._dirtyLevel = 4;
        /**
         * @internal
         */
        this._trackId = 0;
        /**
         * @internal
         */
        this._runnings = 0;
        /**
         * @internal
         */
        this._shouldSchedule = false;
        /**
         * @internal
         */
        this._depsLength = 0;
        recordEffectScope(this, scope);
      }
      get dirty() {
        if (this._dirtyLevel === 2 || this._dirtyLevel === 3) {
          this._dirtyLevel = 1;
          pauseTracking();
          for (let i = 0; i < this._depsLength; i++) {
            const dep = this.deps[i];
            if (dep.computed) {
              triggerComputed(dep.computed);
              if (this._dirtyLevel >= 4) {
                break;
              }
            }
          }
          if (this._dirtyLevel === 1) {
            this._dirtyLevel = 0;
          }
          resetTracking();
        }
        return this._dirtyLevel >= 4;
      }
      set dirty(v) {
        this._dirtyLevel = v ? 4 : 0;
      }
      run() {
        this._dirtyLevel = 0;
        if (!this.active) {
          return this.fn();
        }
        let lastShouldTrack = shouldTrack;
        let lastEffect = activeEffect;
        try {
          shouldTrack = true;
          activeEffect = this;
          this._runnings++;
          preCleanupEffect(this);
          return this.fn();
        } finally {
          postCleanupEffect(this);
          this._runnings--;
          activeEffect = lastEffect;
          shouldTrack = lastShouldTrack;
        }
      }
      stop() {
        var _a;
        if (this.active) {
          preCleanupEffect(this);
          postCleanupEffect(this);
          (_a = this.onStop) == null ? void 0 : _a.call(this);
          this.active = false;
        }
      }
    }
    function triggerComputed(computed) {
      return computed.value;
    }
    function preCleanupEffect(effect2) {
      effect2._trackId++;
      effect2._depsLength = 0;
    }
    function postCleanupEffect(effect2) {
      if (effect2.deps.length > effect2._depsLength) {
        for (let i = effect2._depsLength; i < effect2.deps.length; i++) {
          cleanupDepEffect(effect2.deps[i], effect2);
        }
        effect2.deps.length = effect2._depsLength;
      }
    }
    function cleanupDepEffect(dep, effect2) {
      const trackId = dep.get(effect2);
      if (trackId !== void 0 && effect2._trackId !== trackId) {
        dep.delete(effect2);
        if (dep.size === 0) {
          dep.cleanup();
        }
      }
    }
    let shouldTrack = true;
    const trackStack = [];
    function pauseTracking() {
      trackStack.push(shouldTrack);
      shouldTrack = false;
    }
    function resetTracking() {
      const last = trackStack.pop();
      shouldTrack = last === void 0 ? true : last;
    }
    new Set(
      /* @__PURE__ */ Object.getOwnPropertyNames(Symbol).filter((key) => key !== "arguments" && key !== "caller").map((key) => Symbol[key]).filter(isSymbol)
    );
    function isReactive(value) {
      if (isReadonly(value)) {
        return isReactive(value["__v_raw"]);
      }
      return !!(value && value["__v_isReactive"]);
    }
    function isReadonly(value) {
      return !!(value && value["__v_isReadonly"]);
    }
    function isShallow(value) {
      return !!(value && value["__v_isShallow"]);
    }
    function toRaw(observed) {
      const raw = observed && observed["__v_raw"];
      return raw ? toRaw(raw) : observed;
    }
    function markRaw(value) {
      if (Object.isExtensible(value)) {
        def(value, "__v_skip", true);
      }
      return value;
    }
    function isRef(r) {
      return !!(r && r.__v_isRef === true);
    }
    function unref(ref2) {
      return isRef(ref2) ? ref2.value : ref2;
    }

    /**
    * @vue/runtime-core v3.4.21
    * (c) 2018-present Yuxi (Evan) You and Vue contributors
    * @license MIT
    **/
    function callWithErrorHandling(fn, instance, type, args) {
      try {
        return args ? fn(...args) : fn();
      } catch (err) {
        handleError(err, instance, type);
      }
    }
    function callWithAsyncErrorHandling(fn, instance, type, args) {
      if (isFunction(fn)) {
        const res = callWithErrorHandling(fn, instance, type, args);
        if (res && isPromise(res)) {
          res.catch((err) => {
            handleError(err, instance, type);
          });
        }
        return res;
      }
      const values = [];
      for (let i = 0; i < fn.length; i++) {
        values.push(callWithAsyncErrorHandling(fn[i], instance, type, args));
      }
      return values;
    }
    function handleError(err, instance, type, throwInDev = true) {
      const contextVNode = instance ? instance.vnode : null;
      if (instance) {
        let cur = instance.parent;
        const exposedInstance = instance.proxy;
        const errorInfo = `https://vuejs.org/error-reference/#runtime-${type}`;
        while (cur) {
          const errorCapturedHooks = cur.ec;
          if (errorCapturedHooks) {
            for (let i = 0; i < errorCapturedHooks.length; i++) {
              if (errorCapturedHooks[i](err, exposedInstance, errorInfo) === false) {
                return;
              }
            }
          }
          cur = cur.parent;
        }
        const appErrorHandler = instance.appContext.config.errorHandler;
        if (appErrorHandler) {
          callWithErrorHandling(
            appErrorHandler,
            null,
            10,
            [err, exposedInstance, errorInfo]
          );
          return;
        }
      }
      logError(err, type, contextVNode, throwInDev);
    }
    function logError(err, type, contextVNode, throwInDev = true) {
      {
        console.error(err);
      }
    }

    let isFlushing = false;
    let isFlushPending = false;
    const queue = [];
    let flushIndex = 0;
    const pendingPostFlushCbs = [];
    let activePostFlushCbs = null;
    let postFlushIndex = 0;
    const resolvedPromise = /* @__PURE__ */ Promise.resolve();
    function findInsertionIndex(id) {
      let start = flushIndex + 1;
      let end = queue.length;
      while (start < end) {
        const middle = start + end >>> 1;
        const middleJob = queue[middle];
        const middleJobId = getId(middleJob);
        if (middleJobId < id || middleJobId === id && middleJob.pre) {
          start = middle + 1;
        } else {
          end = middle;
        }
      }
      return start;
    }
    function queueJob(job) {
      if (!queue.length || !queue.includes(
        job,
        isFlushing && job.allowRecurse ? flushIndex + 1 : flushIndex
      )) {
        if (job.id == null) {
          queue.push(job);
        } else {
          queue.splice(findInsertionIndex(job.id), 0, job);
        }
        queueFlush();
      }
    }
    function queueFlush() {
      if (!isFlushing && !isFlushPending) {
        isFlushPending = true;
        resolvedPromise.then(flushJobs);
      }
    }
    function queuePostFlushCb(cb) {
      if (!isArray(cb)) {
        if (!activePostFlushCbs || !activePostFlushCbs.includes(
          cb,
          cb.allowRecurse ? postFlushIndex + 1 : postFlushIndex
        )) {
          pendingPostFlushCbs.push(cb);
        }
      } else {
        pendingPostFlushCbs.push(...cb);
      }
      queueFlush();
    }
    function flushPostFlushCbs(seen) {
      if (pendingPostFlushCbs.length) {
        const deduped = [...new Set(pendingPostFlushCbs)].sort(
          (a, b) => getId(a) - getId(b)
        );
        pendingPostFlushCbs.length = 0;
        if (activePostFlushCbs) {
          activePostFlushCbs.push(...deduped);
          return;
        }
        activePostFlushCbs = deduped;
        for (postFlushIndex = 0; postFlushIndex < activePostFlushCbs.length; postFlushIndex++) {
          activePostFlushCbs[postFlushIndex]();
        }
        activePostFlushCbs = null;
        postFlushIndex = 0;
      }
    }
    const getId = (job) => job.id == null ? Infinity : job.id;
    const comparator = (a, b) => {
      const diff = getId(a) - getId(b);
      if (diff === 0) {
        if (a.pre && !b.pre)
          return -1;
        if (b.pre && !a.pre)
          return 1;
      }
      return diff;
    };
    function flushJobs(seen) {
      isFlushPending = false;
      isFlushing = true;
      queue.sort(comparator);
      const check = NOOP;
      try {
        for (flushIndex = 0; flushIndex < queue.length; flushIndex++) {
          const job = queue[flushIndex];
          if (job && job.active !== false) {
            if (!!("production" !== "production") && check(job)) ;
            callWithErrorHandling(job, null, 14);
          }
        }
      } finally {
        flushIndex = 0;
        queue.length = 0;
        flushPostFlushCbs();
        isFlushing = false;
        if (queue.length || pendingPostFlushCbs.length) {
          flushJobs();
        }
      }
    }

    let currentRenderingInstance = null;
    function queueEffectWithSuspense(fn, suspense) {
      if (suspense && suspense.pendingBranch) {
        if (isArray(fn)) {
          suspense.effects.push(...fn);
        } else {
          suspense.effects.push(fn);
        }
      } else {
        queuePostFlushCb(fn);
      }
    }

    const ssrContextKey = Symbol.for("v-scx");
    const useSSRContext = () => {
      {
        const ctx = inject(ssrContextKey);
        return ctx;
      }
    };
    const INITIAL_WATCHER_VALUE = {};
    function watch(source, cb, options) {
      return doWatch(source, cb, options);
    }
    function doWatch(source, cb, {
      immediate,
      deep,
      flush,
      once,
      onTrack,
      onTrigger
    } = EMPTY_OBJ) {
      if (cb && once) {
        const _cb = cb;
        cb = (...args) => {
          _cb(...args);
          unwatch();
        };
      }
      const instance = currentInstance;
      const reactiveGetter = (source2) => deep === true ? source2 : (
        // for deep: false, only traverse root-level properties
        traverse(source2, deep === false ? 1 : void 0)
      );
      let getter;
      let forceTrigger = false;
      let isMultiSource = false;
      if (isRef(source)) {
        getter = () => source.value;
        forceTrigger = isShallow(source);
      } else if (isReactive(source)) {
        getter = () => reactiveGetter(source);
        forceTrigger = true;
      } else if (isArray(source)) {
        isMultiSource = true;
        forceTrigger = source.some((s) => isReactive(s) || isShallow(s));
        getter = () => source.map((s) => {
          if (isRef(s)) {
            return s.value;
          } else if (isReactive(s)) {
            return reactiveGetter(s);
          } else if (isFunction(s)) {
            return callWithErrorHandling(s, instance, 2);
          } else ;
        });
      } else if (isFunction(source)) {
        if (cb) {
          getter = () => callWithErrorHandling(source, instance, 2);
        } else {
          getter = () => {
            if (cleanup) {
              cleanup();
            }
            return callWithAsyncErrorHandling(
              source,
              instance,
              3,
              [onCleanup]
            );
          };
        }
      } else {
        getter = NOOP;
      }
      if (cb && deep) {
        const baseGetter = getter;
        getter = () => traverse(baseGetter());
      }
      let cleanup;
      let onCleanup = (fn) => {
        cleanup = effect.onStop = () => {
          callWithErrorHandling(fn, instance, 4);
          cleanup = effect.onStop = void 0;
        };
      };
      let ssrCleanup;
      if (isInSSRComponentSetup) {
        onCleanup = NOOP;
        if (!cb) {
          getter();
        } else if (immediate) {
          callWithAsyncErrorHandling(cb, instance, 3, [
            getter(),
            isMultiSource ? [] : void 0,
            onCleanup
          ]);
        }
        if (flush === "sync") {
          const ctx = useSSRContext();
          ssrCleanup = ctx.__watcherHandles || (ctx.__watcherHandles = []);
        } else {
          return NOOP;
        }
      }
      let oldValue = isMultiSource ? new Array(source.length).fill(INITIAL_WATCHER_VALUE) : INITIAL_WATCHER_VALUE;
      const job = () => {
        if (!effect.active || !effect.dirty) {
          return;
        }
        if (cb) {
          const newValue = effect.run();
          if (deep || forceTrigger || (isMultiSource ? newValue.some((v, i) => hasChanged(v, oldValue[i])) : hasChanged(newValue, oldValue)) || false) {
            if (cleanup) {
              cleanup();
            }
            callWithAsyncErrorHandling(cb, instance, 3, [
              newValue,
              // pass undefined as the old value when it's changed for the first time
              oldValue === INITIAL_WATCHER_VALUE ? void 0 : isMultiSource && oldValue[0] === INITIAL_WATCHER_VALUE ? [] : oldValue,
              onCleanup
            ]);
            oldValue = newValue;
          }
        } else {
          effect.run();
        }
      };
      job.allowRecurse = !!cb;
      let scheduler;
      if (flush === "sync") {
        scheduler = job;
      } else if (flush === "post") {
        scheduler = () => queuePostRenderEffect(job, instance && instance.suspense);
      } else {
        job.pre = true;
        if (instance)
          job.id = instance.uid;
        scheduler = () => queueJob(job);
      }
      const effect = new ReactiveEffect(getter, NOOP, scheduler);
      const unwatch = () => {
        effect.stop();
      };
      if (cb) {
        if (immediate) {
          job();
        } else {
          oldValue = effect.run();
        }
      } else if (flush === "post") {
        queuePostRenderEffect(
          effect.run.bind(effect),
          instance && instance.suspense
        );
      } else {
        effect.run();
      }
      if (ssrCleanup)
        ssrCleanup.push(unwatch);
      return unwatch;
    }
    function traverse(value, depth, currentDepth = 0, seen) {
      if (!isObject(value) || value["__v_skip"]) {
        return value;
      }
      if (depth && depth > 0) {
        if (currentDepth >= depth) {
          return value;
        }
        currentDepth++;
      }
      seen = seen || /* @__PURE__ */ new Set();
      if (seen.has(value)) {
        return value;
      }
      seen.add(value);
      if (isRef(value)) {
        traverse(value.value, depth, currentDepth, seen);
      } else if (isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          traverse(value[i], depth, currentDepth, seen);
        }
      } else if (isSet(value) || isMap(value)) {
        value.forEach((v) => {
          traverse(v, depth, currentDepth, seen);
        });
      } else if (isPlainObject(value)) {
        for (const key in value) {
          traverse(value[key], depth, currentDepth, seen);
        }
      }
      return value;
    }
    let currentApp = null;
    function inject(key, defaultValue, treatDefaultAsFactory = false) {
      const instance = currentInstance || currentRenderingInstance;
      if (instance || currentApp) {
        const provides = instance ? instance.parent == null ? instance.vnode.appContext && instance.vnode.appContext.provides : instance.parent.provides : currentApp._context.provides;
        if (provides && key in provides) {
          return provides[key];
        } else if (arguments.length > 1) {
          return treatDefaultAsFactory && isFunction(defaultValue) ? defaultValue.call(instance && instance.proxy) : defaultValue;
        } else ;
      }
    }

    const queuePostRenderEffect = queueEffectWithSuspense ;
    let currentInstance = null;
    {
      const g = getGlobalThis();
      const registerGlobalSetter = (key, setter) => {
        let setters;
        if (!(setters = g[key]))
          setters = g[key] = [];
        setters.push(setter);
        return (v) => {
          if (setters.length > 1)
            setters.forEach((set) => set(v));
          else
            setters[0](v);
        };
      };
      registerGlobalSetter(
        `__VUE_INSTANCE_SETTERS__`,
        (v) => currentInstance = v
      );
      registerGlobalSetter(
        `__VUE_SSR_SETTERS__`,
        (v) => isInSSRComponentSetup = v
      );
    }
    let isInSSRComponentSetup = false;

    function getDevtoolsGlobalHook() {
        return getTarget().__VUE_DEVTOOLS_GLOBAL_HOOK__;
    }
    function getTarget() {
        // @ts-expect-error navigator and windows are not available in all environments
        return (typeof navigator !== 'undefined' && typeof window !== 'undefined')
            ? window
            : typeof globalThis !== 'undefined'
                ? globalThis
                : {};
    }
    const isProxyAvailable = typeof Proxy === 'function';

    const HOOK_SETUP = 'devtools-plugin:setup';
    const HOOK_PLUGIN_SETTINGS_SET = 'plugin:settings:set';

    let supported;
    let perf;
    function isPerformanceSupported() {
        var _a;
        if (supported !== undefined) {
            return supported;
        }
        if (typeof window !== 'undefined' && window.performance) {
            supported = true;
            perf = window.performance;
        }
        else if (typeof globalThis !== 'undefined' && ((_a = globalThis.perf_hooks) === null || _a === void 0 ? void 0 : _a.performance)) {
            supported = true;
            perf = globalThis.perf_hooks.performance;
        }
        else {
            supported = false;
        }
        return supported;
    }
    function now() {
        return isPerformanceSupported() ? perf.now() : Date.now();
    }

    class ApiProxy {
        constructor(plugin, hook) {
            this.target = null;
            this.targetQueue = [];
            this.onQueue = [];
            this.plugin = plugin;
            this.hook = hook;
            const defaultSettings = {};
            if (plugin.settings) {
                for (const id in plugin.settings) {
                    const item = plugin.settings[id];
                    defaultSettings[id] = item.defaultValue;
                }
            }
            const localSettingsSaveId = `__vue-devtools-plugin-settings__${plugin.id}`;
            let currentSettings = Object.assign({}, defaultSettings);
            try {
                const raw = localStorage.getItem(localSettingsSaveId);
                const data = JSON.parse(raw);
                Object.assign(currentSettings, data);
            }
            catch (e) {
                // noop
            }
            this.fallbacks = {
                getSettings() {
                    return currentSettings;
                },
                setSettings(value) {
                    try {
                        localStorage.setItem(localSettingsSaveId, JSON.stringify(value));
                    }
                    catch (e) {
                        // noop
                    }
                    currentSettings = value;
                },
                now() {
                    return now();
                },
            };
            if (hook) {
                hook.on(HOOK_PLUGIN_SETTINGS_SET, (pluginId, value) => {
                    if (pluginId === this.plugin.id) {
                        this.fallbacks.setSettings(value);
                    }
                });
            }
            this.proxiedOn = new Proxy({}, {
                get: (_target, prop) => {
                    if (this.target) {
                        return this.target.on[prop];
                    }
                    else {
                        return (...args) => {
                            this.onQueue.push({
                                method: prop,
                                args,
                            });
                        };
                    }
                },
            });
            this.proxiedTarget = new Proxy({}, {
                get: (_target, prop) => {
                    if (this.target) {
                        return this.target[prop];
                    }
                    else if (prop === 'on') {
                        return this.proxiedOn;
                    }
                    else if (Object.keys(this.fallbacks).includes(prop)) {
                        return (...args) => {
                            this.targetQueue.push({
                                method: prop,
                                args,
                                resolve: () => { },
                            });
                            return this.fallbacks[prop](...args);
                        };
                    }
                    else {
                        return (...args) => {
                            return new Promise((resolve) => {
                                this.targetQueue.push({
                                    method: prop,
                                    args,
                                    resolve,
                                });
                            });
                        };
                    }
                },
            });
        }
        async setRealTarget(target) {
            this.target = target;
            for (const item of this.onQueue) {
                this.target.on[item.method](...item.args);
            }
            for (const item of this.targetQueue) {
                item.resolve(await this.target[item.method](...item.args));
            }
        }
    }

    function setupDevtoolsPlugin(pluginDescriptor, setupFn) {
        const descriptor = pluginDescriptor;
        const target = getTarget();
        const hook = getDevtoolsGlobalHook();
        const enableProxy = isProxyAvailable && descriptor.enableEarlyProxy;
        if (hook && (target.__VUE_DEVTOOLS_PLUGIN_API_AVAILABLE__ || !enableProxy)) {
            hook.emit(HOOK_SETUP, pluginDescriptor, setupFn);
        }
        else {
            const proxy = enableProxy ? new ApiProxy(descriptor, hook) : null;
            const list = target.__VUE_DEVTOOLS_PLUGINS__ = target.__VUE_DEVTOOLS_PLUGINS__ || [];
            list.push({
                pluginDescriptor: descriptor,
                setupFn,
                proxy,
            });
            if (proxy) {
                setupFn(proxy.proxiedTarget);
            }
        }
    }

    /*!
     * pinia v2.1.7
     * (c) 2023 Eduardo San Martin Morote
     * @license MIT
     */
    // type DeepReadonly<T> = { readonly [P in keyof T]: DeepReadonly<T[P]> }
    // TODO: can we change these to numbers?
    /**
     * Possible types for SubscriptionCallback
     */
    var MutationType;
    (function (MutationType) {
        /**
         * Direct mutation of the state:
         *
         * - `store.name = 'new name'`
         * - `store.$state.name = 'new name'`
         * - `store.list.push('new item')`
         */
        MutationType["direct"] = "direct";
        /**
         * Mutated the state with `$patch` and an object
         *
         * - `store.$patch({ name: 'newName' })`
         */
        MutationType["patchObject"] = "patch object";
        /**
         * Mutated the state with `$patch` and a function
         *
         * - `store.$patch(state => state.name = 'newName')`
         */
        MutationType["patchFunction"] = "patch function";
        // maybe reset? for $state = {} and $reset
    })(MutationType || (MutationType = {}));

    const IS_CLIENT = typeof window !== 'undefined';
    /**
     * Should we add the devtools plugins.
     * - only if dev mode or forced through the prod devtools flag
     * - not in test
     * - only if window exists (could change in the future)
     */
    ((typeof __VUE_PROD_DEVTOOLS__ !== 'undefined' && __VUE_PROD_DEVTOOLS__)) && !("production" === 'test') && IS_CLIENT;

    /*
     * FileSaver.js A saveAs() FileSaver implementation.
     *
     * Originally by Eli Grey, adapted as an ESM module by Eduardo San Martin
     * Morote.
     *
     * License : MIT
     */
    // The one and only way of getting global scope in all environments
    // https://stackoverflow.com/q/3277182/1008999
    const _global = /*#__PURE__*/ (() => typeof window === 'object' && window.window === window
        ? window
        : typeof self === 'object' && self.self === self
            ? self
            : typeof global === 'object' && global.global === global
                ? global
                : typeof globalThis === 'object'
                    ? globalThis
                    : { HTMLElement: null })();
    function bom(blob, { autoBom = false } = {}) {
        // prepend BOM for UTF-8 XML and text/* types (including HTML)
        // note: your browser will automatically convert UTF-16 U+FEFF to EF BB BF
        if (autoBom &&
            /^\s*(?:text\/\S*|application\/xml|\S*\/\S*\+xml)\s*;.*charset\s*=\s*utf-8/i.test(blob.type)) {
            return new Blob([String.fromCharCode(0xfeff), blob], { type: blob.type });
        }
        return blob;
    }
    function download(url, name, opts) {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url);
        xhr.responseType = 'blob';
        xhr.onload = function () {
            saveAs(xhr.response, name, opts);
        };
        xhr.onerror = function () {
            console.error('could not download file');
        };
        xhr.send();
    }
    function corsEnabled(url) {
        const xhr = new XMLHttpRequest();
        // use sync to avoid popup blocker
        xhr.open('HEAD', url, false);
        try {
            xhr.send();
        }
        catch (e) { }
        return xhr.status >= 200 && xhr.status <= 299;
    }
    // `a.click()` doesn't work for all browsers (#465)
    function click(node) {
        try {
            node.dispatchEvent(new MouseEvent('click'));
        }
        catch (e) {
            const evt = document.createEvent('MouseEvents');
            evt.initMouseEvent('click', true, true, window, 0, 0, 0, 80, 20, false, false, false, false, 0, null);
            node.dispatchEvent(evt);
        }
    }
    const _navigator =
     typeof navigator === 'object' ? navigator : { userAgent: '' };
    // Detect WebView inside a native macOS app by ruling out all browsers
    // We just need to check for 'Safari' because all other browsers (besides Firefox) include that too
    // https://www.whatismybrowser.com/guides/the-latest-user-agent/macos
    const isMacOSWebView = /*#__PURE__*/ (() => /Macintosh/.test(_navigator.userAgent) &&
        /AppleWebKit/.test(_navigator.userAgent) &&
        !/Safari/.test(_navigator.userAgent))();
    const saveAs = !IS_CLIENT
        ? () => { } // noop
        : // Use download attribute first if possible (#193 Lumia mobile) unless this is a macOS WebView or mini program
            typeof HTMLAnchorElement !== 'undefined' &&
                'download' in HTMLAnchorElement.prototype &&
                !isMacOSWebView
                ? downloadSaveAs
                : // Use msSaveOrOpenBlob as a second approach
                    'msSaveOrOpenBlob' in _navigator
                        ? msSaveAs
                        : // Fallback to using FileReader and a popup
                            fileSaverSaveAs;
    function downloadSaveAs(blob, name = 'download', opts) {
        const a = document.createElement('a');
        a.download = name;
        a.rel = 'noopener'; // tabnabbing
        // TODO: detect chrome extensions & packaged apps
        // a.target = '_blank'
        if (typeof blob === 'string') {
            // Support regular links
            a.href = blob;
            if (a.origin !== location.origin) {
                if (corsEnabled(a.href)) {
                    download(blob, name, opts);
                }
                else {
                    a.target = '_blank';
                    click(a);
                }
            }
            else {
                click(a);
            }
        }
        else {
            // Support blobs
            a.href = URL.createObjectURL(blob);
            setTimeout(function () {
                URL.revokeObjectURL(a.href);
            }, 4e4); // 40s
            setTimeout(function () {
                click(a);
            }, 0);
        }
    }
    function msSaveAs(blob, name = 'download', opts) {
        if (typeof blob === 'string') {
            if (corsEnabled(blob)) {
                download(blob, name, opts);
            }
            else {
                const a = document.createElement('a');
                a.href = blob;
                a.target = '_blank';
                setTimeout(function () {
                    click(a);
                });
            }
        }
        else {
            // @ts-ignore: works on windows
            navigator.msSaveOrOpenBlob(bom(blob, opts), name);
        }
    }
    function fileSaverSaveAs(blob, name, opts, popup) {
        // Open a popup immediately do go around popup blocker
        // Mostly only available on user interaction and the fileReader is async so...
        popup = popup || open('', '_blank');
        if (popup) {
            popup.document.title = popup.document.body.innerText = 'downloading...';
        }
        if (typeof blob === 'string')
            return download(blob, name, opts);
        const force = blob.type === 'application/octet-stream';
        const isSafari = /constructor/i.test(String(_global.HTMLElement)) || 'safari' in _global;
        const isChromeIOS = /CriOS\/[\d]+/.test(navigator.userAgent);
        if ((isChromeIOS || (force && isSafari) || isMacOSWebView) &&
            typeof FileReader !== 'undefined') {
            // Safari doesn't allow downloading of blob URLs
            const reader = new FileReader();
            reader.onloadend = function () {
                let url = reader.result;
                if (typeof url !== 'string') {
                    popup = null;
                    throw new Error('Wrong reader.result type');
                }
                url = isChromeIOS
                    ? url
                    : url.replace(/^data:[^;]*;/, 'data:attachment/file;');
                if (popup) {
                    popup.location.href = url;
                }
                else {
                    location.assign(url);
                }
                popup = null; // reverse-tabnabbing #460
            };
            reader.readAsDataURL(blob);
        }
        else {
            const url = URL.createObjectURL(blob);
            if (popup)
                popup.location.assign(url);
            else
                location.href = url;
            popup = null; // reverse-tabnabbing #460
            setTimeout(function () {
                URL.revokeObjectURL(url);
            }, 4e4); // 40s
        }
    }

    /**
     * Shows a toast or console.log
     *
     * @param message - message to log
     * @param type - different color of the tooltip
     */
    function toastMessage(message, type) {
        const piniaMessage = '🍍 ' + message;
        if (typeof __VUE_DEVTOOLS_TOAST__ === 'function') {
            // No longer available :(
            __VUE_DEVTOOLS_TOAST__(piniaMessage, type);
        }
        else if (type === 'error') {
            console.error(piniaMessage);
        }
        else if (type === 'warn') {
            console.warn(piniaMessage);
        }
        else {
            console.log(piniaMessage);
        }
    }
    function isPinia(o) {
        return '_a' in o && 'install' in o;
    }

    /**
     * This file contain devtools actions, they are not Pinia actions.
     */
    // ---
    function checkClipboardAccess() {
        if (!('clipboard' in navigator)) {
            toastMessage(`Your browser doesn't support the Clipboard API`, 'error');
            return true;
        }
    }
    function checkNotFocusedError(error) {
        if (error instanceof Error &&
            error.message.toLowerCase().includes('document is not focused')) {
            toastMessage('You need to activate the "Emulate a focused page" setting in the "Rendering" panel of devtools.', 'warn');
            return true;
        }
        return false;
    }
    async function actionGlobalCopyState(pinia) {
        if (checkClipboardAccess())
            return;
        try {
            await navigator.clipboard.writeText(JSON.stringify(pinia.state.value));
            toastMessage('Global state copied to clipboard.');
        }
        catch (error) {
            if (checkNotFocusedError(error))
                return;
            toastMessage(`Failed to serialize the state. Check the console for more details.`, 'error');
            console.error(error);
        }
    }
    async function actionGlobalPasteState(pinia) {
        if (checkClipboardAccess())
            return;
        try {
            loadStoresState(pinia, JSON.parse(await navigator.clipboard.readText()));
            toastMessage('Global state pasted from clipboard.');
        }
        catch (error) {
            if (checkNotFocusedError(error))
                return;
            toastMessage(`Failed to deserialize the state from clipboard. Check the console for more details.`, 'error');
            console.error(error);
        }
    }
    async function actionGlobalSaveState(pinia) {
        try {
            saveAs(new Blob([JSON.stringify(pinia.state.value)], {
                type: 'text/plain;charset=utf-8',
            }), 'pinia-state.json');
        }
        catch (error) {
            toastMessage(`Failed to export the state as JSON. Check the console for more details.`, 'error');
            console.error(error);
        }
    }
    let fileInput;
    function getFileOpener() {
        if (!fileInput) {
            fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.json';
        }
        function openFile() {
            return new Promise((resolve, reject) => {
                fileInput.onchange = async () => {
                    const files = fileInput.files;
                    if (!files)
                        return resolve(null);
                    const file = files.item(0);
                    if (!file)
                        return resolve(null);
                    return resolve({ text: await file.text(), file });
                };
                // @ts-ignore: TODO: changed from 4.3 to 4.4
                fileInput.oncancel = () => resolve(null);
                fileInput.onerror = reject;
                fileInput.click();
            });
        }
        return openFile;
    }
    async function actionGlobalOpenStateFile(pinia) {
        try {
            const open = getFileOpener();
            const result = await open();
            if (!result)
                return;
            const { text, file } = result;
            loadStoresState(pinia, JSON.parse(text));
            toastMessage(`Global state imported from "${file.name}".`);
        }
        catch (error) {
            toastMessage(`Failed to import the state from JSON. Check the console for more details.`, 'error');
            console.error(error);
        }
    }
    function loadStoresState(pinia, state) {
        for (const key in state) {
            const storeState = pinia.state.value[key];
            // store is already instantiated, patch it
            if (storeState) {
                Object.assign(storeState, state[key]);
            }
            else {
                // store is not instantiated, set the initial state
                pinia.state.value[key] = state[key];
            }
        }
    }

    function formatDisplay(display) {
        return {
            _custom: {
                display,
            },
        };
    }
    const PINIA_ROOT_LABEL = '🍍 Pinia (root)';
    const PINIA_ROOT_ID = '_root';
    function formatStoreForInspectorTree(store) {
        return isPinia(store)
            ? {
                id: PINIA_ROOT_ID,
                label: PINIA_ROOT_LABEL,
            }
            : {
                id: store.$id,
                label: store.$id,
            };
    }
    function formatStoreForInspectorState(store) {
        if (isPinia(store)) {
            const storeNames = Array.from(store._s.keys());
            const storeMap = store._s;
            const state = {
                state: storeNames.map((storeId) => ({
                    editable: true,
                    key: storeId,
                    value: store.state.value[storeId],
                })),
                getters: storeNames
                    .filter((id) => storeMap.get(id)._getters)
                    .map((id) => {
                    const store = storeMap.get(id);
                    return {
                        editable: false,
                        key: id,
                        value: store._getters.reduce((getters, key) => {
                            getters[key] = store[key];
                            return getters;
                        }, {}),
                    };
                }),
            };
            return state;
        }
        const state = {
            state: Object.keys(store.$state).map((key) => ({
                editable: true,
                key,
                value: store.$state[key],
            })),
        };
        // avoid adding empty getters
        if (store._getters && store._getters.length) {
            state.getters = store._getters.map((getterName) => ({
                editable: false,
                key: getterName,
                value: store[getterName],
            }));
        }
        if (store._customProperties.size) {
            state.customProperties = Array.from(store._customProperties).map((key) => ({
                editable: true,
                key,
                value: store[key],
            }));
        }
        return state;
    }
    function formatEventData(events) {
        if (!events)
            return {};
        if (Array.isArray(events)) {
            // TODO: handle add and delete for arrays and objects
            return events.reduce((data, event) => {
                data.keys.push(event.key);
                data.operations.push(event.type);
                data.oldValue[event.key] = event.oldValue;
                data.newValue[event.key] = event.newValue;
                return data;
            }, {
                oldValue: {},
                keys: [],
                operations: [],
                newValue: {},
            });
        }
        else {
            return {
                operation: formatDisplay(events.type),
                key: formatDisplay(events.key),
                oldValue: events.oldValue,
                newValue: events.newValue,
            };
        }
    }
    function formatMutationType(type) {
        switch (type) {
            case MutationType.direct:
                return 'mutation';
            case MutationType.patchFunction:
                return '$patch';
            case MutationType.patchObject:
                return '$patch';
            default:
                return 'unknown';
        }
    }

    // timeline can be paused when directly changing the state
    let isTimelineActive = true;
    const componentStateTypes = [];
    const MUTATIONS_LAYER_ID = 'pinia:mutations';
    const INSPECTOR_ID = 'pinia';
    const { assign: assign$1 } = Object;
    /**
     * Gets the displayed name of a store in devtools
     *
     * @param id - id of the store
     * @returns a formatted string
     */
    const getStoreType = (id) => '🍍 ' + id;
    /**
     * Add the pinia plugin without any store. Allows displaying a Pinia plugin tab
     * as soon as it is added to the application.
     *
     * @param app - Vue application
     * @param pinia - pinia instance
     */
    function registerPiniaDevtools(app, pinia) {
        setupDevtoolsPlugin({
            id: 'dev.esm.pinia',
            label: 'Pinia 🍍',
            logo: 'https://pinia.vuejs.org/logo.svg',
            packageName: 'pinia',
            homepage: 'https://pinia.vuejs.org',
            componentStateTypes,
            app,
        }, (api) => {
            if (typeof api.now !== 'function') {
                toastMessage('You seem to be using an outdated version of Vue Devtools. Are you still using the Beta release instead of the stable one? You can find the links at https://devtools.vuejs.org/guide/installation.html.');
            }
            api.addTimelineLayer({
                id: MUTATIONS_LAYER_ID,
                label: `Pinia 🍍`,
                color: 0xe5df88,
            });
            api.addInspector({
                id: INSPECTOR_ID,
                label: 'Pinia 🍍',
                icon: 'storage',
                treeFilterPlaceholder: 'Search stores',
                actions: [
                    {
                        icon: 'content_copy',
                        action: () => {
                            actionGlobalCopyState(pinia);
                        },
                        tooltip: 'Serialize and copy the state',
                    },
                    {
                        icon: 'content_paste',
                        action: async () => {
                            await actionGlobalPasteState(pinia);
                            api.sendInspectorTree(INSPECTOR_ID);
                            api.sendInspectorState(INSPECTOR_ID);
                        },
                        tooltip: 'Replace the state with the content of your clipboard',
                    },
                    {
                        icon: 'save',
                        action: () => {
                            actionGlobalSaveState(pinia);
                        },
                        tooltip: 'Save the state as a JSON file',
                    },
                    {
                        icon: 'folder_open',
                        action: async () => {
                            await actionGlobalOpenStateFile(pinia);
                            api.sendInspectorTree(INSPECTOR_ID);
                            api.sendInspectorState(INSPECTOR_ID);
                        },
                        tooltip: 'Import the state from a JSON file',
                    },
                ],
                nodeActions: [
                    {
                        icon: 'restore',
                        tooltip: 'Reset the state (with "$reset")',
                        action: (nodeId) => {
                            const store = pinia._s.get(nodeId);
                            if (!store) {
                                toastMessage(`Cannot reset "${nodeId}" store because it wasn't found.`, 'warn');
                            }
                            else if (typeof store.$reset !== 'function') {
                                toastMessage(`Cannot reset "${nodeId}" store because it doesn't have a "$reset" method implemented.`, 'warn');
                            }
                            else {
                                store.$reset();
                                toastMessage(`Store "${nodeId}" reset.`);
                            }
                        },
                    },
                ],
            });
            api.on.inspectComponent((payload, ctx) => {
                const proxy = (payload.componentInstance &&
                    payload.componentInstance.proxy);
                if (proxy && proxy._pStores) {
                    const piniaStores = payload.componentInstance.proxy._pStores;
                    Object.values(piniaStores).forEach((store) => {
                        payload.instanceData.state.push({
                            type: getStoreType(store.$id),
                            key: 'state',
                            editable: true,
                            value: store._isOptionsAPI
                                ? {
                                    _custom: {
                                        value: toRaw(store.$state),
                                        actions: [
                                            {
                                                icon: 'restore',
                                                tooltip: 'Reset the state of this store',
                                                action: () => store.$reset(),
                                            },
                                        ],
                                    },
                                }
                                : // NOTE: workaround to unwrap transferred refs
                                    Object.keys(store.$state).reduce((state, key) => {
                                        state[key] = store.$state[key];
                                        return state;
                                    }, {}),
                        });
                        if (store._getters && store._getters.length) {
                            payload.instanceData.state.push({
                                type: getStoreType(store.$id),
                                key: 'getters',
                                editable: false,
                                value: store._getters.reduce((getters, key) => {
                                    try {
                                        getters[key] = store[key];
                                    }
                                    catch (error) {
                                        // @ts-expect-error: we just want to show it in devtools
                                        getters[key] = error;
                                    }
                                    return getters;
                                }, {}),
                            });
                        }
                    });
                }
            });
            api.on.getInspectorTree((payload) => {
                if (payload.app === app && payload.inspectorId === INSPECTOR_ID) {
                    let stores = [pinia];
                    stores = stores.concat(Array.from(pinia._s.values()));
                    payload.rootNodes = (payload.filter
                        ? stores.filter((store) => '$id' in store
                            ? store.$id
                                .toLowerCase()
                                .includes(payload.filter.toLowerCase())
                            : PINIA_ROOT_LABEL.toLowerCase().includes(payload.filter.toLowerCase()))
                        : stores).map(formatStoreForInspectorTree);
                }
            });
            api.on.getInspectorState((payload) => {
                if (payload.app === app && payload.inspectorId === INSPECTOR_ID) {
                    const inspectedStore = payload.nodeId === PINIA_ROOT_ID
                        ? pinia
                        : pinia._s.get(payload.nodeId);
                    if (!inspectedStore) {
                        // this could be the selected store restored for a different project
                        // so it's better not to say anything here
                        return;
                    }
                    if (inspectedStore) {
                        payload.state = formatStoreForInspectorState(inspectedStore);
                    }
                }
            });
            api.on.editInspectorState((payload, ctx) => {
                if (payload.app === app && payload.inspectorId === INSPECTOR_ID) {
                    const inspectedStore = payload.nodeId === PINIA_ROOT_ID
                        ? pinia
                        : pinia._s.get(payload.nodeId);
                    if (!inspectedStore) {
                        return toastMessage(`store "${payload.nodeId}" not found`, 'error');
                    }
                    const { path } = payload;
                    if (!isPinia(inspectedStore)) {
                        // access only the state
                        if (path.length !== 1 ||
                            !inspectedStore._customProperties.has(path[0]) ||
                            path[0] in inspectedStore.$state) {
                            path.unshift('$state');
                        }
                    }
                    else {
                        // Root access, we can omit the `.value` because the devtools API does it for us
                        path.unshift('state');
                    }
                    isTimelineActive = false;
                    payload.set(inspectedStore, path, payload.state.value);
                    isTimelineActive = true;
                }
            });
            api.on.editComponentState((payload) => {
                if (payload.type.startsWith('🍍')) {
                    const storeId = payload.type.replace(/^🍍\s*/, '');
                    const store = pinia._s.get(storeId);
                    if (!store) {
                        return toastMessage(`store "${storeId}" not found`, 'error');
                    }
                    const { path } = payload;
                    if (path[0] !== 'state') {
                        return toastMessage(`Invalid path for store "${storeId}":\n${path}\nOnly state can be modified.`);
                    }
                    // rewrite the first entry to be able to directly set the state as
                    // well as any other path
                    path[0] = '$state';
                    isTimelineActive = false;
                    payload.set(store, path, payload.state.value);
                    isTimelineActive = true;
                }
            });
        });
    }
    function addStoreToDevtools(app, store) {
        if (!componentStateTypes.includes(getStoreType(store.$id))) {
            componentStateTypes.push(getStoreType(store.$id));
        }
        setupDevtoolsPlugin({
            id: 'dev.esm.pinia',
            label: 'Pinia 🍍',
            logo: 'https://pinia.vuejs.org/logo.svg',
            packageName: 'pinia',
            homepage: 'https://pinia.vuejs.org',
            componentStateTypes,
            app,
            settings: {
                logStoreChanges: {
                    label: 'Notify about new/deleted stores',
                    type: 'boolean',
                    defaultValue: true,
                },
                // useEmojis: {
                //   label: 'Use emojis in messages ⚡️',
                //   type: 'boolean',
                //   defaultValue: true,
                // },
            },
        }, (api) => {
            // gracefully handle errors
            const now = typeof api.now === 'function' ? api.now.bind(api) : Date.now;
            store.$onAction(({ after, onError, name, args }) => {
                const groupId = runningActionId++;
                api.addTimelineEvent({
                    layerId: MUTATIONS_LAYER_ID,
                    event: {
                        time: now(),
                        title: '🛫 ' + name,
                        subtitle: 'start',
                        data: {
                            store: formatDisplay(store.$id),
                            action: formatDisplay(name),
                            args,
                        },
                        groupId,
                    },
                });
                after((result) => {
                    activeAction = undefined;
                    api.addTimelineEvent({
                        layerId: MUTATIONS_LAYER_ID,
                        event: {
                            time: now(),
                            title: '🛬 ' + name,
                            subtitle: 'end',
                            data: {
                                store: formatDisplay(store.$id),
                                action: formatDisplay(name),
                                args,
                                result,
                            },
                            groupId,
                        },
                    });
                });
                onError((error) => {
                    activeAction = undefined;
                    api.addTimelineEvent({
                        layerId: MUTATIONS_LAYER_ID,
                        event: {
                            time: now(),
                            logType: 'error',
                            title: '💥 ' + name,
                            subtitle: 'end',
                            data: {
                                store: formatDisplay(store.$id),
                                action: formatDisplay(name),
                                args,
                                error,
                            },
                            groupId,
                        },
                    });
                });
            }, true);
            store._customProperties.forEach((name) => {
                watch(() => unref(store[name]), (newValue, oldValue) => {
                    api.notifyComponentUpdate();
                    api.sendInspectorState(INSPECTOR_ID);
                    if (isTimelineActive) {
                        api.addTimelineEvent({
                            layerId: MUTATIONS_LAYER_ID,
                            event: {
                                time: now(),
                                title: 'Change',
                                subtitle: name,
                                data: {
                                    newValue,
                                    oldValue,
                                },
                                groupId: activeAction,
                            },
                        });
                    }
                }, { deep: true });
            });
            store.$subscribe(({ events, type }, state) => {
                api.notifyComponentUpdate();
                api.sendInspectorState(INSPECTOR_ID);
                if (!isTimelineActive)
                    return;
                // rootStore.state[store.id] = state
                const eventData = {
                    time: now(),
                    title: formatMutationType(type),
                    data: assign$1({ store: formatDisplay(store.$id) }, formatEventData(events)),
                    groupId: activeAction,
                };
                if (type === MutationType.patchFunction) {
                    eventData.subtitle = '⤵️';
                }
                else if (type === MutationType.patchObject) {
                    eventData.subtitle = '🧩';
                }
                else if (events && !Array.isArray(events)) {
                    eventData.subtitle = events.type;
                }
                if (events) {
                    eventData.data['rawEvent(s)'] = {
                        _custom: {
                            display: 'DebuggerEvent',
                            type: 'object',
                            tooltip: 'raw DebuggerEvent[]',
                            value: events,
                        },
                    };
                }
                api.addTimelineEvent({
                    layerId: MUTATIONS_LAYER_ID,
                    event: eventData,
                });
            }, { detached: true, flush: 'sync' });
            const hotUpdate = store._hotUpdate;
            store._hotUpdate = markRaw((newStore) => {
                hotUpdate(newStore);
                api.addTimelineEvent({
                    layerId: MUTATIONS_LAYER_ID,
                    event: {
                        time: now(),
                        title: '🔥 ' + store.$id,
                        subtitle: 'HMR update',
                        data: {
                            store: formatDisplay(store.$id),
                            info: formatDisplay(`HMR update`),
                        },
                    },
                });
                // update the devtools too
                api.notifyComponentUpdate();
                api.sendInspectorTree(INSPECTOR_ID);
                api.sendInspectorState(INSPECTOR_ID);
            });
            const { $dispose } = store;
            store.$dispose = () => {
                $dispose();
                api.notifyComponentUpdate();
                api.sendInspectorTree(INSPECTOR_ID);
                api.sendInspectorState(INSPECTOR_ID);
                api.getSettings().logStoreChanges &&
                    toastMessage(`Disposed "${store.$id}" store 🗑`);
            };
            // trigger an update so it can display new registered stores
            api.notifyComponentUpdate();
            api.sendInspectorTree(INSPECTOR_ID);
            api.sendInspectorState(INSPECTOR_ID);
            api.getSettings().logStoreChanges &&
                toastMessage(`"${store.$id}" store installed 🆕`);
        });
    }
    let runningActionId = 0;
    let activeAction;
    /**
     * Patches a store to enable action grouping in devtools by wrapping the store with a Proxy that is passed as the
     * context of all actions, allowing us to set `runningAction` on each access and effectively associating any state
     * mutation to the action.
     *
     * @param store - store to patch
     * @param actionNames - list of actionst to patch
     */
    function patchActionForGrouping(store, actionNames, wrapWithProxy) {
        // original actions of the store as they are given by pinia. We are going to override them
        const actions = actionNames.reduce((storeActions, actionName) => {
            // use toRaw to avoid tracking #541
            storeActions[actionName] = toRaw(store)[actionName];
            return storeActions;
        }, {});
        for (const actionName in actions) {
            store[actionName] = function () {
                // the running action id is incremented in a before action hook
                const _actionId = runningActionId;
                const trackedStore = wrapWithProxy
                    ? new Proxy(store, {
                        get(...args) {
                            activeAction = _actionId;
                            return Reflect.get(...args);
                        },
                        set(...args) {
                            activeAction = _actionId;
                            return Reflect.set(...args);
                        },
                    })
                    : store;
                // For Setup Stores we need https://github.com/tc39/proposal-async-context
                activeAction = _actionId;
                const retValue = actions[actionName].apply(trackedStore, arguments);
                // this is safer as async actions in Setup Stores would associate mutations done outside of the action
                activeAction = undefined;
                return retValue;
            };
        }
    }
    /**
     * pinia.use(devtoolsPlugin)
     */
    function devtoolsPlugin({ app, store, options }) {
        // HMR module
        if (store.$id.startsWith('__hot:')) {
            return;
        }
        // detect option api vs setup api
        store._isOptionsAPI = !!options.state;
        patchActionForGrouping(store, Object.keys(options.actions), store._isOptionsAPI);
        // Upgrade the HMR to also update the new actions
        const originalHotUpdate = store._hotUpdate;
        toRaw(store)._hotUpdate = function (newStore) {
            originalHotUpdate.apply(this, arguments);
            patchActionForGrouping(store, Object.keys(newStore._hmrPayload.actions), !!store._isOptionsAPI);
        };
        addStoreToDevtools(app,
        // FIXME: is there a way to allow the assignment from Store<Id, S, G, A> to StoreGeneric?
        store);
    }

    const enablePiniaDevtools = (vueRootInstance, vueVersion) => {
        if (vueVersion === 2) {
            // There are no plans to support the Vue2 version of Pinia. If needed, please submit an issue and let me know
            return;
        }
        const pinia = vueRootInstance.config.globalProperties.$pinia;
        if (!pinia)
            return;
        pinia.use(devtoolsPlugin);
        registerPiniaDevtools(vueRootInstance, pinia);
    };

    function crack(data) {
        let result;
        if (window.__VUE__) {
            result = crackVue3();
        }
        // Vue 2
        else {
            result = crackVue2();
        }
        if (result)
            data.devtoolsEnabled = true;
        return result;
    }
    function crackVue2(Vue) {
        if (!Vue) {
            const app = getVueRootInstance(2);
            if (!app)
                return false; // Vue may not be finished yet
            Vue = Object.getPrototypeOf(app).constructor;
            while (Vue.super) {
                Vue = Vue.super;
            }
        }
        const devtools = window.__VUE_DEVTOOLS_GLOBAL_HOOK__;
        Vue.config.devtools = true;
        devtools.emit('init', Vue);
        return true;
    }
    function crackVue3() {
        const app = getVueRootInstance(3);
        if (!app)
            return false; // Vue may not be finished yet
        const devtools = window.__VUE_DEVTOOLS_GLOBAL_HOOK__;
        devtools.enabled = true;
        const version = app.version;
        devtools.emit('app:init' /* APP_INIT */, app, version, {
            Fragment: Symbol.for('v-fgt'),
            Text: Symbol.for('v-txt'),
            Comment: Symbol.for('v-cmt'),
            Static: Symbol.for('v-stc'),
        });
        // TODO How to trigger the devtools refresh when vue instance changed.
        // Maybe `devtools.emit("flush")` can be used, but i don't know when, where and how to use it.
        try {
            enablePiniaDevtools(app, 3);
        }
        catch (e) {
            error(e);
        }
        return true;
    }
    function getVueRootInstance(version) {
        const signProperty = version === 2 ? '__vue__' : '__vue_app__';
        const all = document.querySelectorAll('*');
        for (let i = 0; i < all.length; i++) {
            if (all[i][signProperty]) {
                return all[i][signProperty];
            }
        }
    }

    // Receive the message of vue devtools, crack and replay it.
    function listenVueDevtoolsMessage() {
        const messageHandler = (e) => {
            try {
                if (!window.__VUE_DEVTOOLS_GLOBAL_HOOK__)
                    return;
                const data = unpackVueDevtoolsMessage(e.data);
                if (e.source === window && data.vueDetected) {
                    // skip
                    if (data.devtoolsEnabled) {
                        window.removeEventListener('message', messageHandler);
                        return;
                    }
                    detect(e);
                }
            }
            catch (e) {
                error(e);
                window.removeEventListener('message', messageHandler);
            }
        };
        window.addEventListener('message', messageHandler);
    }
    function detect(e) {
        const data = unpackVueDevtoolsMessage(e.data);
        let delay = 1000;
        let detectRemainingTries = 10;
        function executeDetection() {
            // force devtools to be enabled
            if (crack(data)) {
                // replay
                window.postMessage(e.data, '*');
                return;
            }
            if (detectRemainingTries > 0) {
                detectRemainingTries--;
                setTimeout(() => {
                    executeDetection();
                }, delay);
                delay *= 5;
            }
        }
        setTimeout(() => {
            executeDetection();
        }, 100);
    }
    // inject the hook
    if (document instanceof Document) {
        listenVueDevtoolsMessage();
    }

})();
