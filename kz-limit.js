/*!
 * 开张前 · 限流器 (rate limiter) v1.0   [P1-02 / T-10]
 *
 * 纯函数 + 内存滑动窗口，无外部依赖；Node（server.cjs / 测试）使用。
 * 用途：按 IP / 全局限制 /api/extract 的在线 AI 调用，控成本、防滥用。
 * 命中缓存与演示模式的请求不计数（由调用方决定何时调用 check）。
 *
 * 说明：计数是进程内存态，重启清零——对单实例演示场景足够。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KZLimit = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * createLimiter({ limit, windowMs, maxKeys }) -> { check(key, now), size(), reset(), peek(key, now) }
   * 滑动窗口：每个 key 保存窗口内的命中时间戳；超过 limit 则拒绝并给出 retryAfterMs。
   */
  function createLimiter(opts) {
    opts = opts || {};
    var limit = Number(opts.limit) > 0 ? Math.floor(Number(opts.limit)) : 1;
    var windowMs = Number(opts.windowMs) > 0 ? Number(opts.windowMs) : 60000;
    var maxKeys = Number(opts.maxKeys) > 0 ? Math.floor(Number(opts.maxKeys)) : 5000;
    var hits = new Map();

    function prune(arr, cutoff) {
      var i = 0;
      while (i < arr.length && arr[i] <= cutoff) i++;
      return i ? arr.slice(i) : arr;
    }

    function peek(key, now) {
      now = typeof now === 'number' ? now : Date.now();
      var arr = prune(hits.get(key) || [], now - windowMs);
      return { used: arr.length, remaining: Math.max(0, limit - arr.length) };
    }

    function check(key, now) {
      now = typeof now === 'number' ? now : Date.now();
      var arr = prune(hits.get(key) || [], now - windowMs);
      if (arr.length >= limit) {
        hits.set(key, arr);
        var retryAfterMs = Math.max(0, (arr[0] + windowMs) - now);
        return { allowed: false, remaining: 0, retryAfterMs: retryAfterMs, limit: limit, windowMs: windowMs };
      }
      arr = arr.concat([now]);
      hits.set(key, arr);
      // 控制内存：超量时淘汰最早的 key（Map 保序）
      while (hits.size > maxKeys) hits.delete(hits.keys().next().value);
      return { allowed: true, remaining: Math.max(0, limit - arr.length), retryAfterMs: 0, limit: limit, windowMs: windowMs };
    }

    return {
      check: check,
      peek: peek,
      size: function () { return hits.size; },
      reset: function () { hits.clear(); },
      config: { limit: limit, windowMs: windowMs, maxKeys: maxKeys }
    };
  }

  return { createLimiter: createLimiter };
});
