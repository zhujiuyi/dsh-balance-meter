/**
 * @zhujiuyi/dsh-balance — browser half (DSH web client).
 *
 * Loaded as a classic script through `window.__ModuleLoader__.load()`, exactly
 * like every other client bundle. Conventions this file must keep:
 *   - `id` equals the package name, because that identity is how the loader and
 *     the Plugins page address this bundle;
 *   - only platform-seed specifiers may be required (here: `react`); loading
 *     other Harness client packages is against DSH's own authoring rules;
 *   - styles are self-contained: no @import, no remote URLs, and every colour
 *     comes from a `--dsw-*` token so a theme change degrades appearance rather
 *     than rendering.
 *
 * Two extension points are registered:
 *   - `conversation.composer.dock` — the readout. This is the same slot the
 *     shipped session-stats pills use (`id: "stats", order: 0`), so the readout
 *     sits on that row; a negative order puts it to their left.
 *   - `plugins.bundle.config` — a form on this bundle's card on the Plugins
 *     page, so the scalar settings are editable without hand-editing the
 *     profile's cordis.patch.yml.
 *
 * Which route it reports is NOT guessed. A slot's `inject` is handed the
 * session id, and `modelDirectories` resolves that session's current
 * provider/model selection, so the readout follows the model actually in use —
 * rather than listing every adapter the build happens to ship.
 */

window.__ModuleLoader__.load({
	id: '@zhujiuyi/dsh-balance',
	factory(require) {
		const React = require('react')
		const h = React.createElement

		/** Locale namespace this browser half owns. */
		const LOCALE_NS = 'dshBalanceMeter'
		/** Settings namespace of the Loader row this bundle inserts — the row id. */
		const ENTRY_NS = 'balance-meter'
		/** The snapshot route the host half registers. */
		const SNAPSHOT_PATH = '/api/balance-meter/snapshot'
		/** How often the readout re-reads the host cache. Cheap: it is a local read. */
		const POLL_MS = 10000
		/** Fields the configuration form edits, each with its own dictionary keys. */
		const FORM_FIELDS = [
			{ name: 'primary', label: 'fieldPrimary', hint: 'fieldPrimaryHint' },
			{ name: 'autoRefresh', label: 'fieldAutoRefresh', hint: 'fieldAutoRefreshHint' },
			{ name: 'minIntervalSec', label: 'fieldMinInterval', hint: 'fieldMinIntervalHint' },
			{ name: 'staleAfterSec', label: 'fieldStaleAfter', hint: 'fieldStaleAfterHint' },
		]

		const en = {
			chip: 'Balance',
			unavailable: 'Unavailable',
			loading: 'Reading…',
			refresh: 'Refresh now',
			refreshing: 'Refreshing…',
			queried: 'Read',
			never: 'never',
			stale: 'stale',
			secondsAgo: 's ago',
			minutesAgo: 'min ago',
			detail: 'Balance and quota',
			close: 'Close',
			provider: 'Provider',
			billing: 'Billing',
			billingApi: 'API balance',
			billingSubscription: 'Subscription quota',
			endpoint: 'Endpoint',
			credential: 'Credential',
			credentialUnset: 'not set',
			amrLogin: 'AMR login',
			remaining: 'remaining',
			balance: 'Balance',
			noReading: 'The endpoint reported no readable figure',
			cooling: 'cooling',
			refreshable: 'ready',
			closePanel: 'Close',
			trendLabel: 'remaining share over recent readings, count',
			trendCollecting: 'Collecting readings — at least two real readings are needed to draw a trend',
			quotaWindows: 'Quota windows',
			resets: 'resets',
			rawEcho: 'Raw response',
			formHint: 'Saved to this profile’s cordis.patch.yml and applied immediately.',
			fieldPrimary: 'Primary route',
			fieldPrimaryHint: 'Used only when no session model is resolved. Empty uses the first catalogued route.',
			fieldAutoRefresh: 'Refresh automatically',
			fieldAutoRefreshHint: 'Let a finished turn trigger a vendor query, within the interval below.',
			fieldMinInterval: 'Minimum interval (seconds)',
			fieldMinIntervalHint: 'Floor between two automatic vendor queries for the same route.',
			fieldStaleAfter: 'Refresh after (seconds)',
			fieldStaleAfterHint: 'A reading older than this is renewed even if the floor above has not elapsed. Default 300 (5 minutes); 0 disables it.',
			save: 'Save',
			saving: 'Saving…',
			saved: 'Saved.',
			failed: 'The host did not accept this value; the stored setting is unchanged.',
			reset: 'Reset to default',
			overridden: 'Set in this profile',
			readOnly: 'This deployment stores settings read-only.',
			configUnavailable: 'This plugin is not loaded, so its configuration cannot be edited right now.',
		}

		const zh = {
			chip: '余额',
			unavailable: '无法查询',
			loading: '读取中…',
			refresh: '立即刷新',
			refreshing: '刷新中…',
			queried: '读取于',
			never: '尚未读取',
			stale: '可能已过期',
			secondsAgo: ' 秒前',
			minutesAgo: ' 分钟前',
			detail: '余额与余量',
			close: '关闭',
			provider: '供应商',
			billing: '计费方式',
			billingApi: 'API 余额',
			billingSubscription: '订阅余量',
			endpoint: '接口地址',
			credential: '凭据变量',
			credentialUnset: '未配置',
			amrLogin: 'AMR 登录态',
			remaining: '剩余',
			balance: '余额',
			noReading: '接口未给出可读数值',
			cooling: '冷却中',
			refreshable: '可刷新',
			closePanel: '关闭面板',
			trendLabel: '最近读数的剩余额度趋势，共',
			trendCollecting: '正在累积读数，至少需要两次真实读数才能画出趋势',
			quotaWindows: '额度窗口',
			resets: '重置',
			rawEcho: '原始响应',
			formHint: '保存会写入本 profile 的 cordis.patch.yml 并立即生效。',
			fieldPrimary: '兜底路由',
			fieldPrimaryHint: '仅在未能解析出会话模型时使用；留空则取目录里第一条可识别的路由。',
			fieldAutoRefresh: '自动刷新',
			fieldAutoRefreshHint: '允许一轮对话结束后触发供应商查询，仍受下面的最小间隔约束。',
			fieldMinInterval: '最小刷新间隔（秒）',
			fieldMinIntervalHint: '同一路由两次自动查询之间的最短间隔。',
			fieldStaleAfter: '超过多久自动刷新（秒）',
			fieldStaleAfterHint: '读数超过这个时长就会刷新，即使上面的最小间隔尚未到。默认 300（5 分钟）；填 0 表示不启用。',
			save: '保存',
			saving: '保存中…',
			saved: '已保存。',
			failed: '宿主没有接受该值；已保存的设置未改变。',
			reset: '恢复默认',
			overridden: '本 profile 已设置',
			readOnly: '本部署的设置为只读。',
			configUnavailable: '该插件当前未加载，暂时无法编辑它的配置。',
		}

		/**
		 * Styles under this plugin's own prefix.
		 *
		 * The chip and the panel follow the supplied telemetry mock: a pill
		 * trigger with a pulsing status dot, and a light instrument panel with a
		 * big numeral, a ring gauge, segmented bars and a staggered entrance.
		 *
		 * Two deliberate departures from the mock, both because this is a live
		 * host surface rather than a standalone page:
		 *   - colours resolve through `--dsw-*` tokens where they exist, so a
		 *     theme swap degrades the look instead of making text unreadable;
		 *   - the panel keeps the mock's own palette for its instrument parts
		 *     (gauge arc, bar gradient), because those are brand marks rather than
		 *     theme chrome.
		 *
		 * Sized to sit on the composer stats row; the panel opens upward because
		 * that row is at the bottom of the window.
		 */
		const CSS = [
			// ── trigger ──────────────────────────────────────────────────────
			'.dsh-balance-anchor{position:relative;display:inline-flex;align-items:center;min-width:0}',
			'.dsh-balance-chip{display:inline-flex;align-items:center;gap:7px;height:26px;padding:0 10px;flex:none;appearance:none;margin:0;border-radius:999px;border:1px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:1;white-space:nowrap;letter-spacing:.01em;box-shadow:inset 0 1px 0 rgba(255,255,255,.04);transition:transform .22s cubic-bezier(.22,.9,.24,1),border-color .22s,color .22s,background .22s,box-shadow .22s}',
			'.dsh-balance-chip:hover{transform:translateY(-1px);border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary) 8%,transparent)}',
			'.dsh-balance-chip:active{transform:translateY(0) scale(.98)}',
			'.dsh-balance-chip:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}',
			'.dsh-balance-dot{position:relative;width:5px;height:5px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary)}',
			'.dsh-balance-dot[data-ok="true"]{background:var(--dsw-alias-state-business-primary);box-shadow:0 0 9px color-mix(in srgb,var(--dsw-alias-state-business-primary) 60%,transparent)}',
			'.dsh-balance-dot[data-ok="true"]::after{content:"";position:absolute;inset:-3px;border-radius:50%;border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 55%,transparent);animation:dsh-balance-pulse 2.6s cubic-bezier(.22,.9,.24,1) infinite}',
			'.dsh-balance-chip[data-busy="true"] .dsh-balance-dot{animation:dsh-balance-blink .4s steps(2,end) 3}',
			'.dsh-balance-value{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
			'.dsh-balance-value b{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:600;color:var(--dsw-alias-state-business-primary);font-size:11px}',
			'.dsh-balance-wlabel{font-weight:600;letter-spacing:.02em}',
			'.dsh-balance-wlabel[data-kind="time"]{color:#3fb950}',
			'.dsh-balance-wlabel[data-kind="week"]{color:#58a6ff}',
			'.dsh-balance-wlabel[data-empty="true"]{color:#f85149}',
			'.dsh-balance-wpct{color:#f0f6fc}',
			'.dsh-balance-sep{color:var(--dsw-alias-label-tertiary)}',
			'.dsh-balance-value[data-ok="false"]{color:var(--dsw-alias-label-tertiary)}',
			'.dsh-balance-chev{width:10px;height:10px;flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .3s cubic-bezier(.16,1,.3,1)}',
			'.dsh-balance-chip[aria-expanded="true"] .dsh-balance-chev{transform:rotate(180deg)}',

			// ── panel shell ──────────────────────────────────────────────────
			'.dsh-balance-pop{--bm-ink:#10201b;--bm-ink2:#3a5048;--bm-muted:#5b706a;--bm-line:rgba(12,72,58,.16);--bm-line-soft:rgba(16,54,45,.085);--bm-mint:#077a63;--bm-lime:#5f8a00;--bm-amber:#8f5300;--bm-track:rgba(16,60,50,.09);--bm-tick:rgba(16,60,50,.18);--bm-seg:rgba(248,251,249,1);position:absolute;bottom:calc(100% + 8px);left:0;z-index:60;width:440px;max-height:min(70vh,640px);overflow-y:auto;overscroll-behavior:contain;padding:17px 20px 18px;border-radius:18px;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l4) 70%,rgba(255,255,255,.7));background:linear-gradient(165deg,rgba(255,255,255,.97),rgba(241,247,244,.965));backdrop-filter:blur(24px) saturate(140%);-webkit-backdrop-filter:blur(24px) saturate(140%);box-shadow:0 44px 96px -34px rgba(0,0,0,.9),0 0 0 1px rgba(10,50,40,.07),0 1px 0 rgba(255,255,255,.92) inset;color:var(--bm-ink);font:inherit;font-size:13px;line-height:1.55;text-align:left;cursor:default;transform-origin:100% 100%;scrollbar-width:thin;scrollbar-color:rgba(11,138,112,.26) transparent;animation:dsh-balance-pop-in .5s cubic-bezier(.16,1,.3,1)}',
			'.dsh-balance-pop::-webkit-scrollbar{width:6px}',
			'.dsh-balance-pop::-webkit-scrollbar-thumb{background:rgba(11,138,112,.24);border-radius:3px}',
			'.dsh-balance-pop::-webkit-scrollbar-track{background:transparent}',
			'.dsh-balance-pop::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:1;background:radial-gradient(340px circle at var(--bm-mx,72%) var(--bm-my,0%),rgba(11,150,120,.1),transparent 64%);opacity:0;transition:opacity .3s}',
			'.dsh-balance-pop:hover::before{opacity:1}',
			'.dsh-balance-sheen{position:absolute;left:0;right:0;top:0;height:1px;z-index:3;pointer-events:none;background:linear-gradient(90deg,transparent 0 28%,rgba(11,160,128,.8) 50%,transparent 72% 100%);background-size:220% 100%;animation:dsh-balance-sheen 7s linear infinite}',
			'.dsh-balance-corner{position:absolute;width:11px;height:11px;border:0 solid rgba(11,138,112,.32);z-index:3;pointer-events:none}',
			'.dsh-balance-corner[data-pos="tl"]{top:9px;left:9px;border-top-width:1px;border-left-width:1px;border-top-left-radius:4px}',
			'.dsh-balance-corner[data-pos="tr"]{top:9px;right:9px;border-top-width:1px;border-right-width:1px;border-top-right-radius:4px}',
			'.dsh-balance-corner[data-pos="bl"]{bottom:9px;left:9px;border-bottom-width:1px;border-left-width:1px;border-bottom-left-radius:4px}',
			'.dsh-balance-corner[data-pos="br"]{bottom:9px;right:9px;border-bottom-width:1px;border-right-width:1px;border-bottom-right-radius:4px}',
			'.dsh-balance-scan{position:absolute;inset:0;border-radius:inherit;overflow:hidden;pointer-events:none;z-index:4}',
			'.dsh-balance-scan::before{content:"";position:absolute;left:-25%;right:-25%;top:-170px;height:170px;background:linear-gradient(180deg,transparent,rgba(11,160,128,.08) 45%,rgba(11,160,128,.26) 70%,rgba(95,138,0,.12) 82%,transparent);opacity:0}',
			'.dsh-balance-pop[data-scanning="true"] .dsh-balance-scan::before{animation:dsh-balance-scan 1.1s cubic-bezier(.22,.9,.24,1) forwards}',
			'.dsh-balance-pop[data-scanning="true"] .dsh-balance-hero-num{animation:dsh-balance-glitch .42s steps(2,end) 2}',

			// staggered entrance — one delay per block, like the mock
			'.dsh-balance-stagger{position:relative;z-index:2;animation:dsh-balance-rise .62s cubic-bezier(.16,1,.3,1) both;animation-delay:calc(var(--bm-i,0) * 45ms + 90ms)}',

			// ── header ───────────────────────────────────────────────────────
			'.dsh-balance-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-bottom:13px;border-bottom:1px solid var(--bm-line-soft)}',
			'.dsh-balance-title{display:flex;align-items:center;gap:8px;min-width:0;font-size:12.5px;letter-spacing:.05em;color:var(--bm-ink2);font-weight:600;white-space:nowrap}',
			'.dsh-balance-status{width:5px;height:5px;border-radius:50%;flex:none;background:var(--bm-mint);box-shadow:0 0 8px rgba(7,122,99,.42);animation:dsh-balance-breathe 3.4s ease-in-out infinite}',
			'.dsh-balance-headcode{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:8.5px;letter-spacing:.13em;color:var(--bm-muted);font-weight:400;margin-left:2px;white-space:nowrap}',
			'.dsh-balance-close{width:28px;height:28px;flex:none;border-radius:7px;display:grid;place-items:center;padding:0;appearance:none;color:var(--bm-muted);border:1px solid transparent;background:none;cursor:pointer;transition:color .2s,background .2s,border-color .2s,transform .35s cubic-bezier(.16,1,.3,1)}',
			'.dsh-balance-close:hover{color:var(--bm-ink);background:rgba(10,60,50,.06);border-color:var(--bm-line-soft);transform:rotate(90deg)}',
			'.dsh-balance-close:focus-visible{outline:2px solid var(--bm-mint);outline-offset:2px}',

			// ── hero ─────────────────────────────────────────────────────────
			'.dsh-balance-hero{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:16px 0 13px}',
			'.dsh-balance-hero-copy{min-width:0}',
			'.dsh-balance-kicker{display:flex;align-items:center;gap:7px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;letter-spacing:.16em;color:var(--bm-muted);text-transform:uppercase}',
			'.dsh-balance-kicker::before{content:"";width:12px;height:1px;background:var(--bm-mint);opacity:.6}',
			'.dsh-balance-hero-num{display:flex;align-items:baseline;gap:3px;margin-top:5px;font-size:58px;line-height:.9;letter-spacing:-.035em;font-weight:600;color:#0c1a16;font-variant-numeric:tabular-nums;text-shadow:0 1px 0 rgba(255,255,255,.65)}',
			'.dsh-balance-pct{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:21px;font-weight:500;color:var(--bm-mint);letter-spacing:0;text-shadow:none}',
			'.dsh-balance-hero-meta{display:flex;align-items:center;gap:6px;margin-top:10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;color:var(--bm-muted);letter-spacing:.03em;white-space:nowrap}',
			'.dsh-balance-mini{width:5px;height:5px;border-radius:50%;background:var(--bm-mint);box-shadow:0 0 7px rgba(11,138,112,.55);flex:none;animation:dsh-balance-breathe 3.2s ease-in-out infinite}',
			'.dsh-balance-gauge{width:102px;height:102px;flex:none;position:relative}',
			'.dsh-balance-gauge svg{width:100%;height:100%;overflow:visible}',
			'.dsh-balance-gauge-track{fill:none;stroke:var(--bm-track);stroke-width:5}',
			'.dsh-balance-gauge-arc{fill:none;stroke:url(#dsh-balance-arc);stroke-width:5;stroke-linecap:round;stroke-dasharray:100;stroke-dashoffset:100;transition:stroke-dashoffset 1.35s cubic-bezier(.16,1,.3,1);filter:drop-shadow(0 2px 5px rgba(11,138,112,.22))}',
			'.dsh-balance-gauge-tick{stroke:var(--bm-tick);stroke-width:1;transition:stroke .45s ease,opacity .45s ease}',
			'.dsh-balance-gauge-tick[data-on="true"]{stroke:var(--bm-mint);opacity:.72}',
			'.dsh-balance-gauge-core{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:1px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:19px;font-weight:600;color:var(--bm-ink);font-variant-numeric:tabular-nums}',
			'.dsh-balance-gauge-unit{font-size:9px;color:var(--bm-muted);font-weight:400;margin-top:2px}',

			// ── section label ────────────────────────────────────────────────
			'.dsh-balance-section{display:flex;align-items:center;gap:10px;margin:1px 0 4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9px;letter-spacing:.16em;color:var(--bm-muted);text-transform:uppercase}',
			'.dsh-balance-section::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,var(--bm-line-soft),transparent)}',
			'.dsh-balance-section-code{color:rgba(70,95,87,.72)}',

			// ── one quota window ─────────────────────────────────────────────
			'.dsh-balance-win{padding:10px 10px 11px;margin:0 -10px;border-radius:10px;transition:background .25s,transform .25s}',
			'.dsh-balance-win:hover{background:rgba(10,60,50,.035);transform:translateX(2px)}',
			'.dsh-balance-win-top{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:9px}',
			'.dsh-balance-win-name{font-size:14px;letter-spacing:.01em;color:var(--bm-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
			'.dsh-balance-win-sep{color:var(--bm-muted);margin:0 2px}',
			'.dsh-balance-win-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:8.5px;letter-spacing:.12em;color:rgba(70,95,87,.75);margin-left:5px}',
			'.dsh-balance-win-val{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;color:var(--bm-mint);white-space:nowrap;font-variant-numeric:tabular-nums}',
			'.dsh-balance-win-val b{font-weight:600}',
			'.dsh-balance-bar{position:relative;height:8px;border-radius:2px;background:var(--bm-track);overflow:hidden}',
			'.dsh-balance-bar::after{content:"";position:absolute;inset:0;z-index:3;pointer-events:none;background:repeating-linear-gradient(90deg,transparent 0 8px,var(--bm-seg) 8px 10px);opacity:.9}',
			'.dsh-balance-bar-fill{position:absolute;left:0;top:0;bottom:0;width:0;border-radius:2px;overflow:hidden;background:linear-gradient(90deg,rgba(11,138,112,.32) 0%,var(--bm-mint) 55%,var(--bm-lime) 100%);box-shadow:0 0 14px rgba(11,138,112,.24);transition:width 1.35s cubic-bezier(.16,1,.3,1)}',
			'.dsh-balance-bar-fill::after{content:"";position:absolute;top:-4px;bottom:-4px;width:34%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.5),transparent);transform:translateX(-160%) skewX(-18deg);animation:dsh-balance-shimmer 3.6s ease-in-out infinite}',
			'.dsh-balance-bar-marker{position:absolute;top:-3px;bottom:-3px;width:2px;left:0;z-index:4;border-radius:1px;background:var(--bm-lime);box-shadow:0 0 8px rgba(95,138,0,.6);transition:left 1.35s cubic-bezier(.16,1,.3,1)}',
			'.dsh-balance-win-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;color:var(--bm-muted);letter-spacing:.03em}',
			'.dsh-balance-win-foot .dsh-balance-mono{color:var(--bm-ink2)}',
			'.dsh-balance-win-window{font-size:8px;letter-spacing:.13em;color:rgba(70,95,87,.65)}',

			// ── trend ────────────────────────────────────────────────────────
			'.dsh-balance-trend{margin-top:7px;padding-top:10px;border-top:1px solid var(--bm-line-soft)}',
			'.dsh-balance-trend-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:2px}',
			'.dsh-balance-trend-title{font-size:12.5px;color:var(--bm-ink);letter-spacing:.01em}',
			'.dsh-balance-trend-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:8px;letter-spacing:.1em;color:rgba(70,95,87,.7);margin-left:6px}',
			'.dsh-balance-trend-delta{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9.5px;color:var(--bm-muted);white-space:nowrap}',
			'.dsh-balance-trend-delta b{font-weight:600;color:var(--bm-amber)}',
			'.dsh-balance-trend-svg{display:block;width:100%;height:64px;overflow:visible}',
			'.dsh-balance-trend-grid line{stroke:var(--bm-line-soft);stroke-width:1;stroke-dasharray:2 4}',
			'.dsh-balance-trend-line{stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 2px 3px rgba(11,138,112,.16));transition:stroke-dashoffset 1.25s cubic-bezier(.16,1,.3,1)}',
			'.dsh-balance-trend-area{opacity:0;transition:opacity .7s ease .3s}',
			'.dsh-balance-trend[data-drawn="true"] .dsh-balance-trend-area{opacity:1}',
			'.dsh-balance-trend-dot{fill:#fff;stroke:var(--bm-mint);stroke-width:2;opacity:0;transform:scale(.3);transform-box:fill-box;transform-origin:center;transition:opacity .3s ease,transform .45s cubic-bezier(.16,1,.3,1)}',
			'.dsh-balance-trend[data-drawn="true"] .dsh-balance-trend-dot{opacity:1;transform:scale(1);transition-delay:.9s}',
			'.dsh-balance-trend-axis{display:flex;justify-content:space-between;margin-top:3px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:8px;letter-spacing:.08em;color:rgba(70,95,87,.62)}',
			'.dsh-balance-trend-empty{display:grid;place-items:center;height:64px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9.5px;letter-spacing:.06em;color:rgba(70,95,87,.66);text-align:center;border-top:1px dashed var(--bm-line-soft);border-bottom:1px dashed var(--bm-line-soft)}',

			// ── meta rows ────────────────────────────────────────────────────
			'.dsh-balance-meta{border-top:1px solid var(--bm-line-soft);margin-top:6px;padding-top:7px}',
			'.dsh-balance-meta .dsh-balance-row{display:grid;grid-template-columns:76px 1fr;gap:10px;align-items:start;padding:7px 0;border-bottom:1px solid rgba(16,54,45,.055)}',
			'.dsh-balance-meta .dsh-balance-row:last-child{border-bottom:none;padding-bottom:2px}',
			'.dsh-balance-key{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;letter-spacing:.08em;color:var(--bm-muted);padding-top:2px;white-space:nowrap}',
			'.dsh-balance-val{font-size:13px;line-height:1.55;color:var(--bm-ink2);min-width:0}',
			'.dsh-balance-badge{display:inline-block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:8.5px;letter-spacing:.04em;color:var(--bm-mint);border:1px solid rgba(11,138,112,.26);background:rgba(11,138,112,.07);padding:1.5px 5px;border-radius:4px;margin-left:4px;vertical-align:1px;white-space:nowrap}',
			'.dsh-balance-endpoint{display:block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.65;letter-spacing:-.005em;color:var(--bm-ink2);overflow-wrap:anywhere;word-break:break-all}',
			'.dsh-balance-reading{display:flex;align-items:center;gap:6px}',
			'.dsh-balance-read-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:8px;letter-spacing:.12em;color:rgba(70,95,87,.65);margin-left:4px}',

			// ── messages ─────────────────────────────────────────────────────
			'.dsh-balance-msg{margin:8px 0 0;font-size:12px;line-height:1.55;color:var(--bm-muted);white-space:pre-wrap;word-break:break-word}',
			'.dsh-balance-msg[data-error="true"]{color:#a03b1d}',
			'.dsh-balance-raw{margin:4px 0 0;padding:7px 8px;border-radius:6px;background:rgba(16,60,50,.05);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;line-height:1.5;white-space:pre-wrap;word-break:break-all;max-height:150px;overflow:auto;color:var(--bm-ink2)}',

			// ── footer ───────────────────────────────────────────────────────
			'.dsh-balance-foot{display:flex;flex-direction:column;gap:11px;margin-top:12px;padding-top:13px;border-top:1px solid var(--bm-line-soft)}',
			'.dsh-balance-foot-meta{display:flex;align-items:center;justify-content:space-between;gap:10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9px;line-height:1.6;color:var(--bm-muted);letter-spacing:.02em;white-space:nowrap}',
			'.dsh-balance-foot-meta .dsh-balance-mono{color:var(--bm-ink2)}',
			'.dsh-balance-cool{color:var(--bm-mint);font-size:9px;letter-spacing:.06em}',
			'.dsh-balance-cool[data-cooling="true"]{color:var(--bm-amber)}',
			'.dsh-balance-foot-actions{display:flex;align-items:stretch;gap:10px}',
			'.dsh-balance-foot-actions>button{flex:1 1 0;min-width:0}',
			'.dsh-balance-close-bottom{height:38px;display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:0 14px;appearance:none;border:1px solid var(--bm-line);border-radius:9px;background:rgba(255,255,255,.42);color:var(--bm-ink2);font:inherit;font-size:12.5px;font-weight:600;letter-spacing:.02em;cursor:pointer;box-shadow:inset 0 1px 0 rgba(255,255,255,.6);transition:background .2s,color .2s,border-color .2s,transform .2s,box-shadow .2s}',
			'.dsh-balance-close-bottom:hover{background:rgba(255,255,255,.72);color:var(--bm-ink);border-color:rgba(11,138,112,.34);box-shadow:inset 0 1px 0 rgba(255,255,255,.7),0 8px 18px -14px rgba(8,45,36,.5)}',
			'.dsh-balance-close-bottom:active{transform:scale(.99)}',
			'.dsh-balance-close-bottom:focus-visible{outline:2px solid var(--bm-mint);outline-offset:2px}',
			'.dsh-balance-close-bottom svg{width:12px;height:12px;flex:none}',
			'.dsh-balance-keyhint{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:8px;letter-spacing:.1em;color:rgba(70,95,87,.55);border:1px solid var(--bm-line-soft);border-radius:3px;padding:1px 4px;margin-left:3px}',
			'.dsh-balance-refresh{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:8px;height:38px;min-width:132px;padding:0 16px;appearance:none;border-radius:9px;overflow:hidden;border:1px solid #123f35;background:linear-gradient(180deg,#14453a,#0b2b24);color:#eafff8;font:inherit;font-size:12.5px;font-weight:600;letter-spacing:.02em;cursor:pointer;box-shadow:0 8px 18px -12px rgba(8,45,36,.7);transition:transform .2s cubic-bezier(.22,.9,.24,1),border-color .2s,box-shadow .2s,color .2s,background .2s}',
			'.dsh-balance-refresh::after{content:"";position:absolute;left:0;bottom:0;height:2px;width:100%;background:linear-gradient(90deg,#2fdcb6,#b6e34f);transform:scaleX(var(--bm-cd,0));transform-origin:left;opacity:.9;transition:transform .28s linear}',
			'.dsh-balance-refresh:hover:not(:disabled){transform:translateY(-1px);border-color:#1c6a57;box-shadow:0 12px 26px -12px rgba(8,45,36,.55)}',
			'.dsh-balance-refresh:active:not(:disabled){transform:translateY(0) scale(.985)}',
			'.dsh-balance-refresh:focus-visible{outline:2px solid var(--bm-mint);outline-offset:2px}',
			'.dsh-balance-refresh:disabled{cursor:not-allowed;color:#7e928b;background:rgba(16,60,50,.05);border-color:rgba(16,60,50,.12);box-shadow:none}',
			'.dsh-balance-refresh svg{width:15px;height:15px;flex:none}',
			'.dsh-balance-refresh[data-spinning="true"] svg{animation:dsh-balance-spin .85s linear infinite}',

			// ── configuration form (unchanged surface, own tokens) ───────────
			'.dsh-balance-form{display:flex;flex-direction:column;gap:14px;padding:12px 0;max-width:520px}',
			'.dsh-balance-field{display:flex;flex-direction:column;gap:6px}',
			'.dsh-balance-fieldhead{display:flex;align-items:center;gap:8px}',
			'.dsh-balance-label{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}',
			'.dsh-balance-field-badge{font-size:11px;padding:1px 6px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-4);color:var(--dsw-alias-label-secondary)}',
			'.dsh-balance-input{height:34px;padding:0 12px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);font:inherit;font-size:13px;color:var(--dsw-alias-label-primary)}',
			'.dsh-balance-input:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}',
			'.dsh-balance-input:disabled{color:var(--dsw-alias-label-tertiary)}',
			'.dsh-balance-check{display:flex;align-items:center;gap:8px}',
			'.dsh-balance-hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
			'.dsh-balance-btn{appearance:none;border:1px solid transparent;border-radius:var(--dsw-radius-md);padding:4px 12px;font:inherit;font-size:12px;line-height:1.5;cursor:pointer;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}',
			'.dsh-balance-btn:disabled{opacity:.4;cursor:default}',
			'.dsh-balance-note{color:var(--dsw-alias-label-tertiary);font-size:11px}',
			'.dsh-balance-reset{border:none;background:none;padding:0;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer}',
			'.dsh-balance-reset:disabled{opacity:.4;cursor:default}',

			// ── keyframes ────────────────────────────────────────────────────
			'@keyframes dsh-balance-pulse{0%{transform:scale(.55);opacity:.85}70%{transform:scale(2.6);opacity:0}100%{opacity:0}}',
			'@keyframes dsh-balance-breathe{0%,100%{opacity:1}50%{opacity:.4}}',
			'@keyframes dsh-balance-blink{50%{opacity:.25}}',
			'@keyframes dsh-balance-spin{to{transform:rotate(360deg)}}',
			'@keyframes dsh-balance-shimmer{0%{transform:translateX(-160%) skewX(-18deg)}55%,100%{transform:translateX(360%) skewX(-18deg)}}',
			'@keyframes dsh-balance-sheen{0%{background-position:200% 0}100%{background-position:-120% 0}}',
			'@keyframes dsh-balance-scan{0%{top:-170px;opacity:0}12%{opacity:1}100%{top:calc(100% + 40px);opacity:0}}',
			'@keyframes dsh-balance-glitch{0%,100%{transform:translateX(0);text-shadow:0 1px 0 rgba(255,255,255,.65)}20%{transform:translateX(-2px);text-shadow:2px 0 rgba(11,138,112,.42),-2px 0 rgba(190,90,60,.2)}45%{transform:translateX(2px);text-shadow:-2px 0 rgba(95,138,0,.38),2px 0 rgba(11,138,112,.28)}70%{transform:translateX(-1px);text-shadow:1px 0 rgba(11,138,112,.36)}}',
			'@keyframes dsh-balance-pop-in{from{opacity:0;transform:translateY(-14px) scale(.94);filter:blur(10px)}to{opacity:1;transform:none;filter:none}}',
			'@keyframes dsh-balance-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}',
			'.dsh-balance-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}',
			'@media (max-width:720px){.dsh-balance-pop{width:min(440px,calc(100vw - 24px))}.dsh-balance-hero-num{font-size:54px}.dsh-balance-gauge{width:96px;height:96px}}',
			'@media (prefers-reduced-motion:reduce){.dsh-balance-pop,.dsh-balance-stagger{animation:none}.dsh-balance-bar-fill::after,.dsh-balance-sheen{display:none}.dsh-balance-bar-fill,.dsh-balance-bar-marker,.dsh-balance-gauge-arc{transition-duration:.001ms}}',
		].join('')

		/**
		 * Format a timestamp as a short relative age.
		 * @param {number | null} at
		 * @param {(key: string) => string} t
		 * @returns {string}
		 */
		function ago(at, t) {
			if (typeof at !== 'number' || !Number.isFinite(at)) return t('never')
			const seconds = Math.max(0, Math.round((Date.now() - at) / 1000))
			if (seconds < 60) return `${seconds}${t('secondsAgo')}`
			return `${Math.round(seconds / 60)}${t('minutesAgo')}`
		}

		/**
		 * Render an ISO reset time in the reader's own locale, degrading to the
		 * raw string rather than throwing on an unexpected value.
		 * @param {unknown} value
		 * @returns {string}
		 */
		function resetText(value) {
			if (typeof value !== 'string' || value === '') return ''
			const at = Date.parse(value)
			if (!Number.isFinite(at)) return value
			return new Date(at).toLocaleString(undefined, {
				month: 'numeric',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
			})
		}

		/**
		 * Read the host snapshot.
		 *
		 * The request carries the page's session cookie automatically; a failure
		 * here is reported in the readout rather than thrown, because the
		 * composer must keep rendering even when the host half is unavailable.
		 * @param {{ route: string | null, refresh: boolean }} query
		 * @returns {Promise<object>}
		 */
		async function readSnapshot(query) {
			const params = new URLSearchParams()
			if (query.route !== null && query.route !== '') params.set('route', query.route)
			if (query.refresh) params.set('refresh', '1')
			const suffix = params.toString() === '' ? '' : `?${params.toString()}`
			const response = await fetch(`${SNAPSHOT_PATH}${suffix}`, {
				method: 'GET',
				credentials: 'same-origin',
				headers: { accept: 'application/json' },
			})
			if (!response.ok) throw new Error(`HTTP ${response.status}`)
			return response.json()
		}

		/**
		 * Resolve a session's current provider.
		 *
		 * `modelDirectories.directoryFor(sessionId).store` holds the session's
		 * live `{provider, model, reasoningEffort}` selection, so this follows the
		 * model actually selected rather than assuming a default. Returns null
		 * when any link in that chain is unavailable, which leaves the host to
		 * fall back to its primary route.
		 * @param {unknown} directories
		 * @param {string | undefined} sessionId
		 * @returns {object | null}
		 */
		function directoryFor(directories, sessionId) {
			if (directories === null || typeof directories !== 'object') return null
			if (typeof sessionId !== 'string' || sessionId === '') return null
			try {
				return typeof directories.directoryFor === 'function'
					? directories.directoryFor(sessionId)
					: null
			} catch {
				return null
			}
		}

		/**
		 * Subscribe to a session's model selection.
		 * @param {object | null} directory
		 * @returns {{provider: string | null, model: string | null}}
		 */
		function useModelSelection(directory) {
			const store = directory !== null && typeof directory === 'object' ? directory.store : null
			const subscribe = React.useCallback(
				(listener) => (store !== null && typeof store.subscribe === 'function'
					? store.subscribe(listener)
					: () => {}),
				[store],
			)
			const read = React.useCallback(
				() => (store !== null && typeof store.getSnapshot === 'function'
					? store.getSnapshot()
					: null),
				[store],
			)
			const snapshot = React.useSyncExternalStore(subscribe, read, read)

			// Nudge the directory to load once; a failure is not ours to surface,
			// because the selector the user actually drives reports its own.
			React.useEffect(() => {
				if (directory === null || typeof directory.load !== 'function') return
				try {
					Promise.resolve(directory.load()).catch(() => {})
				} catch {
					// A directory that refuses to load simply leaves provider null.
				}
			}, [directory])

			const current = snapshot !== null && typeof snapshot === 'object' ? snapshot.current : null
			const provider = current !== null && typeof current === 'object' ? current.provider : null
			const model = current !== null && typeof current === 'object' ? current.model : null
			return {
				provider: typeof provider === 'string' && provider !== '' ? provider : null,
				model: typeof model === 'string' && model !== '' ? model : null,
			}
		}

		/**
		 * The readout.
		 *
		 * Owns its own polling because the host keeps no timer: a poll asks for a
		 * snapshot, and the host decides whether that poll is allowed to become a
		 * real vendor request. The host separately refreshes on `turn/end`, so a
		 * poll mostly just picks up an already-fresh cached reading.
		 * @param {{ t: (key: string) => string, sessionId?: string, directories?: unknown }} props
		 */
		function BalanceReadout(props) {
			const { t, sessionId, directories } = props
			const directory = React.useMemo(
				() => directoryFor(directories, sessionId),
				[directories, sessionId],
			)
			const { provider } = useModelSelection(directory)

			const [snapshot, setSnapshot] = React.useState(null)
			const [error, setError] = React.useState(null)
			const [busy, setBusy] = React.useState(false)
			const [open, setOpen] = React.useState(false)
			/** Drives the scan sweep and the hero glitch while a read is in flight. */
			const [scanning, setScanning] = React.useState(false)
			const anchor = React.useRef(null)

			const load = React.useCallback(async (refresh) => {
				try {
					const next = await readSnapshot({ route: provider, refresh })
					setSnapshot(next)
					setError(null)
					return next
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause))
					return null
				}
			}, [provider])

			// Re-read on mount, whenever the selected provider changes, and on a
			// slow poll so a reading refreshed by the host shows up on its own.
			React.useEffect(() => {
				let alive = true
				void load(false)
				const timer = setInterval(() => {
					if (!alive) return
					if (typeof document === 'undefined' || document.visibilityState === 'visible') {
						void load(false)
					}
				}, POLL_MS)
				return () => {
					alive = false
					clearInterval(timer)
				}
			}, [load])

			// Close the popover on Escape or an outside click.
			React.useEffect(() => {
				if (!open) return undefined
				const onKey = (event) => {
					if (event.key === 'Escape') setOpen(false)
				}
				const onDown = (event) => {
					if (anchor.current !== null && !anchor.current.contains(event.target)) setOpen(false)
				}
				document.addEventListener('keydown', onKey)
				document.addEventListener('mousedown', onDown)
				return () => {
					document.removeEventListener('keydown', onKey)
					document.removeEventListener('mousedown', onDown)
				}
			}, [open])

			const routes = snapshot !== null && Array.isArray(snapshot.routes) ? snapshot.routes : []
			const states = snapshot !== null && Array.isArray(snapshot.states) ? snapshot.states : []
			const route = routes[0]
			const state = states[0]
			// Whether there is a figure to render is the host's answer, not this
			// file's: it sends `value` null when it has nothing, and keeps sending
			// the last good figure — with `stale` set and `message` explaining why —
			// when a later attempt failed. Deriving this from `status` here is what
			// made a single failed automatic refresh blank a perfectly good reading.
			const value = state !== undefined && state !== null && typeof state.value === 'string'
				? state.value
				: null
			const hasValue = value !== null
			const stale = state !== undefined && state !== null && state.stale === true

			// A reading younger than the configured floor is not eligible for an
			// automatic refresh yet, so the footer says so instead of offering a
			// button that would be a no-op. Manual refresh still works — it forces.
			const cooling = React.useMemo(() => {
				if (busy) return true
				if (state === undefined || state === null) return false
				const floor = snapshot !== null && typeof snapshot.minIntervalSec === 'number'
					? snapshot.minIntervalSec * 1000
					: 0
				if (floor <= 0) return false
				const at = typeof state.queriedAt === 'number' ? state.queriedAt : 0
				return at > 0 && Date.now() - at < floor
			}, [busy, state, snapshot])

			let text = hasValue ? value : t('loading')
			if (!hasValue && (error !== null || snapshot !== null)) text = t('unavailable')

			/** Refresh on demand, bypassing the host's cooldown. */
			async function refreshNow() {
				setBusy(true)
				setScanning(true)
				await load(true)
				setScanning(false)
				setBusy(false)
			}

			const windows = state !== undefined && state !== null
				&& state.result !== null
				&& Array.isArray(state.result.windows)
				? state.result.windows
				: []
			// The binding window is the one with the least remaining, not merely the
			// first one: a 5-hour window at 100% with a weekly window at 0% is
			// unusable, so the gauge must reflect the weekly one.
			const focusWindow = windows.reduce(
				(least, w) => (typeof w.remainingPct === 'number' && (least === null || w.remainingPct < least.remainingPct) ? w : least),
				null,
			)
			const heroPct = focusWindow !== null ? Math.round(focusWindow.remainingPct) : null
			// A route whose reading is money (no windows) still has a figure, and
			// the hero degrades to it rather than inventing a percentage.
			const heroText = heroPct !== null ? String(heroPct) : (hasValue ? value : '—')
			const heroIsPct = heroPct !== null

			// Multi-window plans (5-hour + weekly) fail on whichever window runs out
			// first, so the chip lists both shares; the label colour encodes the
			// window kind, an exhausted window turns red, and the number stays white.
			const shortWindowLabel = (label) => {
				const value = String(label ?? '').replace(/^Design Plan ·\s*/u, '').trim()
				const hours = value.match(/(\d+)\s*小时/u)
				if (hours !== null) return `${hours[1]}小时`
				if (/周|week/i.test(value)) return '周'
				const days = value.match(/(\d+)\s*天/u)
				if (days !== null) return days[1] === '7' ? '周' : `${days[1]}天`
				return value
			}
			const windowKind = (label) => (/周|week|7\s*天/iu.test(String(label ?? '')) ? 'week' : 'time')
			const chipWindows = windows.filter((w) => typeof w.remainingPct === 'number').slice(0, 2)
			const chipParts = []
			if (chipWindows.length >= 2) {
				for (const [index, w] of chipWindows.entries()) {
					if (index > 0) chipParts.push(h('span', { className: 'dsh-balance-sep', 'aria-hidden': 'true' }, ' · '))
					const pct = Math.max(0, Math.round(w.remainingPct))
					chipParts.push(h('span', {
						className: 'dsh-balance-wlabel',
						'data-kind': windowKind(w.label),
						'data-empty': pct <= 0 ? 'true' : 'false',
					}, shortWindowLabel(w.label)))
					chipParts.push(h('span', { className: 'dsh-balance-wpct' }, ` ${pct}%`))
				}
			}
			const chipContent = chipParts.length > 0 ? chipParts : text

			const history = routeHistory(snapshot, route)

			return h(
				'div',
				{ className: 'dsh-balance-anchor', ref: anchor },
				h(
					'button',
					{
						type: 'button',
						className: 'dsh-balance-chip',
						title: error === null ? t('chip') : `${t('chip')}: ${error}`,
						'aria-expanded': open ? 'true' : 'false',
						'data-busy': busy ? 'true' : 'false',
						onClick: () => setOpen((next) => !next),
					},
					h('span', { className: 'dsh-balance-dot', 'data-ok': hasValue ? 'true' : 'false' }),
					h(
						'span',
						{ className: 'dsh-balance-value', 'data-ok': stale ? 'false' : hasValue ? 'true' : 'false' },
						chipContent,
					),
					h(
						'svg',
						{
							className: 'dsh-balance-chev',
							viewBox: '0 0 14 14',
							fill: 'none',
							'aria-hidden': 'true',
						},
						h('path', {
							d: 'M3.2 5.4 7 9.2l3.8-3.8',
							stroke: 'currentColor',
							strokeWidth: 1.4,
							strokeLinecap: 'round',
							strokeLinejoin: 'round',
						}),
					),
				),
				open
					? h(
							'div',
							{
								className: 'dsh-balance-pop',
								role: 'dialog',
								'aria-label': t('detail'),
								'data-scanning': scanning ? 'true' : 'false',
							},
							// ── decorative chrome ──────────────────────────────
							h('span', { className: 'dsh-balance-sheen', 'aria-hidden': 'true' }),
							h('span', { className: 'dsh-balance-corner', 'data-pos': 'tl', 'aria-hidden': 'true' }),
							h('span', { className: 'dsh-balance-corner', 'data-pos': 'tr', 'aria-hidden': 'true' }),
							h('span', { className: 'dsh-balance-corner', 'data-pos': 'bl', 'aria-hidden': 'true' }),
							h('span', { className: 'dsh-balance-corner', 'data-pos': 'br', 'aria-hidden': 'true' }),
							h('span', { className: 'dsh-balance-scan', 'aria-hidden': 'true' }),

							// ── header ────────────────────────────────────────
							h(
								'header',
								{ className: 'dsh-balance-head dsh-balance-stagger', style: { '--bm-i': 0 } },
								h(
									'span',
									{ className: 'dsh-balance-title' },
									h('span', { className: 'dsh-balance-status', 'aria-hidden': 'true' }),
									t('detail'),
									h('span', { className: 'dsh-balance-headcode' }, 'BALANCE · QUOTA'),
								),
								h(
									'button',
									{
										type: 'button',
										className: 'dsh-balance-close',
										'aria-label': t('close'),
										onClick: () => setOpen(false),
									},
									h(
										'svg',
										{ width: 13, height: 13, viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': 'true' },
										h('path', {
											d: 'M2.6 2.6 11.4 11.4M11.4 2.6 2.6 11.4',
											stroke: 'currentColor',
											strokeWidth: 1.4,
											strokeLinecap: 'round',
										}),
									),
								),
							),

							error !== null
								? h('p', { className: 'dsh-balance-msg', 'data-error': 'true' }, error)
								: null,

							// ── hero: big numeral + ring gauge ─────────────────
							h(
								'section',
								{
									className: 'dsh-balance-hero dsh-balance-stagger',
									style: { '--bm-i': 1 },
								},
								h(
									'div',
									{ className: 'dsh-balance-hero-copy' },
									h(
										'div',
										{ className: 'dsh-balance-kicker' },
										focusWindow !== null
											? `${focusWindow.label} ${t('remaining')}`
											: t('balance'),
									),
									h(
										'div',
										{ className: 'dsh-balance-hero-num' },
										h('span', { className: 'dsh-balance-hero-num' }, heroText),
										heroIsPct ? h('span', { className: 'dsh-balance-pct' }, '%') : null,
									),
									focusWindow !== null && focusWindow.resetAt !== undefined
										? h(
												'div',
												{ className: 'dsh-balance-hero-meta' },
												h('span', { className: 'dsh-balance-mini', 'aria-hidden': 'true' }),
												`${t('resets')} `,
												h('span', { className: 'dsh-balance-mono' }, resetText(focusWindow.resetAt)),
											)
										: stale
											? h(
													'div',
													{ className: 'dsh-balance-hero-meta' },
													h('span', { className: 'dsh-balance-mini', 'aria-hidden': 'true' }),
													t('stale'),
												)
											: null,
								),
								heroIsPct ? h(Gauge, { pct: heroPct }) : null,
							),

							// ── quota windows ─────────────────────────────────
							windows.length > 0
								? h(
										'div',
										{ className: 'dsh-balance-stagger', style: { '--bm-i': 2 } },
										h(
											'div',
											{ className: 'dsh-balance-section' },
											h('span', null, t('quotaWindows')),
											h(
												'span',
												{ className: 'dsh-balance-section-code' },
												`QUOTA / ${String(windows.length).padStart(2, '0')}`,
											),
										),
										windows.map((window, index) =>
											h(QuotaWindow, {
												key: `${window.key}-${index}`,
												t,
												window,
												index,
											})),
									)
								: null,

							// ── trend, drawn only from real readings ──────────
							focusWindow !== null
								? h(
										'div',
										{ className: 'dsh-balance-stagger', style: { '--bm-i': 5 } },
										h(Trend, {
											t,
											points: pointsFor(history, focusWindow.key),
											label: focusWindow.label,
										}),
									)
								: null,

							state !== undefined && state !== null && state.message !== null
								? h(
										'p',
										{
											className: 'dsh-balance-msg',
											'data-error': state.status !== 'ok' ? 'true' : 'false',
										},
										state.message,
									)
								: null,
							snapshot !== null && typeof snapshot.note === 'string'
								? h('p', { className: 'dsh-balance-msg' }, snapshot.note)
								: null,
							snapshot !== null && snapshot.error !== undefined
								? h('p', { className: 'dsh-balance-msg', 'data-error': 'true' }, snapshot.error)
								: null,
							state !== undefined && state !== null && typeof state.raw === 'string' && state.raw !== ''
								? h(
										'div',
										{ className: 'dsh-balance-stagger', style: { '--bm-i': 6 } },
										h('div', { className: 'dsh-balance-key' }, t('rawEcho')),
										h('pre', { className: 'dsh-balance-raw' }, state.raw),
									)
								: null,

							// ── provider metadata ────────────────────────────
							route !== undefined
								? h(
										'div',
										{ className: 'dsh-balance-meta dsh-balance-stagger', style: { '--bm-i': 6 } },
										h(
											'div',
											{ className: 'dsh-balance-row' },
											h('span', { className: 'dsh-balance-key' }, t('provider')),
											h(
												'span',
												{ className: 'dsh-balance-val' },
												route.label,
												// A control-plane provider is authorised by the AMR login on
												// disk, so it has no credential variable to name — saying
												// "credential unset" there would be plainly wrong.
												h(
													'span',
													{ className: 'dsh-balance-badge' },
													route.controlPlane === true
														? t('amrLogin')
														: route.apiKeyEnv === null || route.apiKeyEnv === ''
															? t('credentialUnset')
															: route.apiKeyEnv,
												),
											),
										),
										route.billing !== null
											? h(
													'div',
													{ className: 'dsh-balance-row' },
													h('span', { className: 'dsh-balance-key' }, t('billing')),
													h(
														'span',
														{ className: 'dsh-balance-val' },
														route.billing === 'subscription'
															? t('billingSubscription')
															: t('billingApi'),
													),
												)
											: null,
										state !== undefined && state !== null && state.url !== null
											? h(
													'div',
													{ className: 'dsh-balance-row' },
													h('span', { className: 'dsh-balance-key' }, t('endpoint')),
													h(
														'span',
														{ className: 'dsh-balance-endpoint' },
														state.url.replace(/^https?:\/\//, ''),
													),
												)
											: null,
										h(
											'div',
											{ className: 'dsh-balance-row' },
											h('span', { className: 'dsh-balance-key' }, t('queried')),
											h(
												'span',
												{ className: 'dsh-balance-reading dsh-balance-val' },
												h('span', { className: 'dsh-balance-mini', 'aria-hidden': 'true' }),
												state === undefined || state === null
													? t('never')
													: ago(state.queriedAt, t),
												h(
													'span',
													{ className: 'dsh-balance-read-code' },
													snapshot !== null && snapshot.autoRefresh === false ? 'MANUAL' : 'AUTO',
												),
											),
										),
									)
								: null,

							// ── footer ────────────────────────────────────────
							h(
								'footer',
								{ className: 'dsh-balance-foot dsh-balance-stagger', style: { '--bm-i': 7 } },
								h(
									'div',
									{ className: 'dsh-balance-foot-meta' },
									h(
										'span',
										null,
										`${t('fieldMinInterval')} `,
										h(
											'span',
											{ className: 'dsh-balance-mono' },
											snapshot !== null && typeof snapshot.minIntervalSec === 'number'
												? `${snapshot.minIntervalSec}s`
												: '—',
										),
									),
									h(
										'span',
										{
											className: 'dsh-balance-cool',
											'data-cooling': cooling ? 'true' : 'false',
										},
										cooling ? t('cooling') : t('refreshable'),
									),
								),
								h(
									'div',
									{ className: 'dsh-balance-foot-actions' },
									h(
										'button',
										{
											type: 'button',
											className: 'dsh-balance-close-bottom',
											onClick: () => setOpen(false),
										},
										h(
											'svg',
											{ viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': 'true' },
											h('path', {
												d: 'M2.6 2.6 11.4 11.4M11.4 2.6 2.6 11.4',
												stroke: 'currentColor',
												strokeWidth: 1.4,
												strokeLinecap: 'round',
											}),
										),
										t('closePanel'),
										h('span', { className: 'dsh-balance-keyhint' }, 'ESC'),
									),
									h(
										'button',
										{
											type: 'button',
											className: 'dsh-balance-refresh',
											disabled: busy,
											'data-spinning': busy ? 'true' : 'false',
											onClick: () => {
												void refreshNow()
											},
										},
										h(
											'svg',
											{ viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
											h('path', {
												d: 'M13.4 8a5.4 5.4 0 1 1-1.58-3.82',
												stroke: 'currentColor',
												strokeWidth: 1.4,
												strokeLinecap: 'round',
											}),
											h('path', {
												d: 'M13.6 2.7v3.1h-3.1',
												stroke: 'currentColor',
												strokeWidth: 1.4,
												strokeLinecap: 'round',
												strokeLinejoin: 'round',
											}),
										),
										busy ? t('refreshing') : t('refresh'),
									),
								),
							),
							h('span', { className: 'dsh-balance-sr', 'aria-live': 'polite' }),
						)
					: null,
			)
		}

		/**
		 * One quota window: name, share, a segmented bar and its reset time.
		 *
		 * The mock prints a hardcoded percentage; here the number is the reading's
		 * own `remainingPct`, and a window that reported no readable pair draws
		 * its name and the reason instead of a bar — never a fabricated width.
		 * @param {{ t: (key: string) => string, window: object, index: number }} props
		 */
		function QuotaWindow(props) {
			const { t, index } = props
			const w = props.window
			const pct = typeof w.remainingPct === 'number' ? w.remainingPct : null
			const reset = resetText(w.resetAt)
			// The backend names windows "Design Plan · 5 小时"; split the prefix off
			// so the row can style the two halves the way the mock does.
			const label = typeof w.label === 'string' && w.label !== '' ? w.label : `WINDOW ${index + 1}`
			const cut = label.indexOf('·')
			const head = cut >= 0 ? label.slice(0, cut).trim() : label
			const tail = cut >= 0 ? label.slice(cut + 1).trim() : ''
			const ordinal = String(index + 1).padStart(2, '0')

			return h(
				'div',
				{ className: 'dsh-balance-win' },
				h(
					'div',
					{ className: 'dsh-balance-win-top' },
					h(
						'div',
						{ className: 'dsh-balance-win-name' },
						head,
						tail === ''
							? null
							: h('span', null,
									h('span', { className: 'dsh-balance-win-sep' }, '·'),
									` ${tail}`),
						h('span', { className: 'dsh-balance-win-code' }, ordinal),
					),
					h(
						'div',
						{ className: 'dsh-balance-win-val' },
						pct === null
							? '—'
							: h('b', null, pct.toFixed(0)),
						pct === null ? null : '%',
					),
				),
				pct === null
					? h(
							'div',
							{ className: 'dsh-balance-win-foot' },
							h('span', null, w.note !== undefined ? w.note : t('noReading')),
						)
					: h(
							'div',
							{
								className: 'dsh-balance-bar',
								role: 'img',
								'aria-label': `${label} ${t('remaining')} ${pct.toFixed(0)}%`,
							},
							h('div', { className: 'dsh-balance-bar-fill', style: { width: `${pct}%` } }),
							h('div', { className: 'dsh-balance-bar-marker', style: { left: `${pct}%` } }),
						),
				pct === null
					? null
					: h(
							'div',
							{ className: 'dsh-balance-win-foot' },
							h(
								'span',
								null,
								`${t('resets')} `,
								reset === ''
									? h('span', { className: 'dsh-balance-mono' }, '—')
									: h('span', { className: 'dsh-balance-mono' }, reset),
							),
							h('span', { className: 'dsh-balance-win-window' }, `WINDOW ${ordinal}`),
						),
			)
		}

		/**
		 * The ring gauge: track, 64 ticks, and an arc at the current share.
		 *
		 * A real SVG with `pathLength="100"`, so the arc's dash offset is literally
		 * the percentage and the transition is a CSS one rather than a timer.
		 * @param {{ pct: number }} props
		 */
		function Gauge(props) {
			const pct = Math.max(0, Math.min(100, Math.round(props.pct)))
			const ticks = []
			const N = 64
			for (let i = 0; i < N; i++) {
				const a = (i / N) * Math.PI * 2 - Math.PI / 2
				const rOuter = 43.6
				const rInner = 39.6
				ticks.push(h('line', {
					key: i,
					className: 'dsh-balance-gauge-tick',
					'data-on': i / N < pct / 100 ? 'true' : 'false',
					x1: (60 + Math.cos(a) * rInner).toFixed(2),
					y1: (60 + Math.sin(a) * rInner).toFixed(2),
					x2: (60 + Math.cos(a) * rOuter).toFixed(2),
					y2: (60 + Math.sin(a) * rOuter).toFixed(2),
					strokeLinecap: 'round',
				}))
			}
			return h(
				'div',
				{ className: 'dsh-balance-gauge' },
				h(
					'svg',
					{ className: 'dsh-balance-gauge-svg', viewBox: '0 0 120 120', 'aria-hidden': 'true' },
					h(
						'defs',
						null,
						h(
							'linearGradient',
							{ id: 'dsh-balance-arc', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
							h('stop', { offset: '0%', stopColor: '#0a8a6e' }),
							h('stop', { offset: '100%', stopColor: '#5f8a00' }),
						),
					),
					h('circle', { className: 'dsh-balance-gauge-track', cx: 60, cy: 60, r: 49 }),
					h('g', null, ticks),
					h('circle', {
						className: 'dsh-balance-gauge-arc',
						cx: 60,
						cy: 60,
						r: 49,
						pathLength: 100,
						transform: 'rotate(-90 60 60)',
						style: { strokeDashoffset: String(100 - pct) },
					}),
				),
				h(
					'div',
					{ className: 'dsh-balance-gauge-core' },
					String(pct),
					h('span', { className: 'dsh-balance-gauge-unit' }, '%'),
				),
			)
		}

		/**
		 * The trend line, drawn only from readings the host actually took.
		 *
		 * The mock ships 25 hardcoded values and calls the chart "示意". This one
		 * refuses to do that: with fewer than two real samples it says so and
		 * draws nothing, because a curve implies history that did not happen.
		 * @param {{ t: (key: string) => string, points: {at: number, pct: number}[], label: string }} props
		 */
		function Trend(props) {
			const { t } = props
			const points = Array.isArray(props.points) ? props.points : []
			const W = 380
			const H = 64
			const padX = 4
			const top = 8
			const bottom = 8

			if (points.length < 2) {
				return h(
					'div',
					{ className: 'dsh-balance-trend' },
					h(
						'div',
						{ className: 'dsh-balance-trend-head' },
						h(
							'div',
							{ className: 'dsh-balance-trend-title' },
							props.label,
							h('span', { className: 'dsh-balance-trend-code' }, 'HISTORY'),
						),
					),
					h('div', { className: 'dsh-balance-trend-empty' }, t('trendCollecting')),
				)
			}

			const values = points.map((p) => p.pct)
			const lo = Math.min(...values) - 0.6
			const hi = Math.max(...values) + 0.6
			const span = hi - lo || 1
			const xy = points.map((p, i) => ({
				x: padX + (W - padX * 2) * (i / (points.length - 1)),
				y: top + (H - top - bottom) * (1 - (p.pct - lo) / span),
			}))
			const d = xy.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ')
			const first = xy[0]
			const last = xy[xy.length - 1]
			const area = `${d} L ${last.x.toFixed(2)} ${H - bottom} L ${first.x.toFixed(2)} ${H - bottom} Z`
			const delta = points[points.length - 1].pct - points[0].pct

			return h(
				'div',
				{ className: 'dsh-balance-trend', 'data-drawn': 'true' },
				h(
					'div',
					{ className: 'dsh-balance-trend-head' },
					h(
						'div',
						{ className: 'dsh-balance-trend-title' },
						props.label,
						h('span', { className: 'dsh-balance-trend-code' }, `HISTORY · ${points.length}`),
					),
					h(
						'div',
						{ className: 'dsh-balance-trend-delta' },
						h('b', null, `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} pt`),
					),
				),
				h(
					'svg',
					{
						className: 'dsh-balance-trend-svg',
						viewBox: `0 0 ${W} ${H}`,
						preserveAspectRatio: 'xMidYMid meet',
						role: 'img',
						'aria-label': `${props.label} ${t('trendLabel')} ${points.length}`,
					},
					h(
						'defs',
						null,
						h(
							'linearGradient',
							{ id: 'dsh-balance-trend-fill', x1: '0', y1: '0', x2: '0', y2: '1' },
							h('stop', { offset: '0%', stopColor: '#077a63', stopOpacity: '.22' }),
							h('stop', { offset: '100%', stopColor: '#077a63', stopOpacity: '0' }),
						),
						h(
							'linearGradient',
							{ id: 'dsh-balance-trend-line', x1: '0', y1: '0', x2: '1', y2: '0' },
							h('stop', { offset: '0%', stopColor: '#5f8a00' }),
							h('stop', { offset: '100%', stopColor: '#077a63' }),
						),
					),
					h(
						'g',
						{ className: 'dsh-balance-trend-grid', 'aria-hidden': 'true' },
						h('line', { x1: 2, y1: 14, x2: 378, y2: 14 }),
						h('line', { x1: 2, y1: 34, x2: 378, y2: 34 }),
						h('line', { x1: 2, y1: 54, x2: 378, y2: 54 }),
					),
					h('path', { className: 'dsh-balance-trend-area', d: area, fill: 'url(#dsh-balance-trend-fill)' }),
					h('path', {
						className: 'dsh-balance-trend-line',
						d,
						fill: 'none',
						stroke: 'url(#dsh-balance-trend-line)',
						strokeWidth: 2,
					}),
					h('circle', { className: 'dsh-balance-trend-dot', cx: last.x.toFixed(2), cy: last.y.toFixed(2), r: 3.5 }),
				),
			)
		}

		/**
		 * Read the retained readings for the route on screen.
		 *
		 * The host sends this per route; a missing route or a host that predates
		 * the field both yield an empty list, which the chart reports honestly.
		 * @param {object | null} snapshot
		 * @param {object | undefined} route
		 * @returns {{key: string, points: {at: number, pct: number}[]}[]}
		 */
		function routeHistory(snapshot, route) {
			if (snapshot === null || typeof snapshot !== 'object') return []
			if (route === undefined || route === null) return []
			const byRoute = snapshot.history
			if (byRoute === null || typeof byRoute !== 'object') return []
			const series = byRoute[route.key]
			return Array.isArray(series) ? series : []
		}

		/**
		 * Pick the series matching a window, falling back to the first one.
		 *
		 * Window keys are policy ids on OpenDesign and generated names elsewhere,
		 * so an exact match is preferred but never required — one series is better
		 * than an empty chart when the key spellings drift.
		 * @param {{key: string, points: object[]}[]} history
		 * @param {string} windowKey
		 * @returns {{at: number, pct: number}[]}
		 */
		function pointsFor(history, windowKey) {
			const match = history.find((series) => series.key === windowKey)
			if (match !== undefined) return match.points
			return history.length > 0 ? history[0].points : []
		}

		/**
		 * The bundle's configuration form.
		 * @param {object} scope
		 */
		function configFormFor(scope) {
			/** @param {{ t: (key: string) => string }} props */
			return function BalanceConfigForm(props) {
				const t = props.t
				const [busy, setBusy] = React.useState(false)
				const [dirty, setDirty] = React.useState(false)
				const [outcome, setOutcome] = React.useState(null)
				const [seenRevision, setSeenRevision] = React.useState(undefined)
				const inputs = React.useRef({})
				const keepOutcome = React.useRef(false)

				const subscribe = React.useMemo(() => (listener) => scope.subscribe(listener), [scope])
				const readState = React.useMemo(() => () => scope.getSnapshot(), [scope])
				const state = React.useSyncExternalStore(subscribe, readState, readState)
				const revision = state === undefined || state === null ? undefined : state.revision
				if (seenRevision !== revision) {
					setSeenRevision(revision)
					setDirty(false)
					if (keepOutcome.current) keepOutcome.current = false
					else setOutcome(null)
				}

				if (state === undefined || state === null || state.status === 'unavailable') {
					return h('p', { className: 'dsh-balance-hint', role: 'status' }, t('configUnavailable'))
				}
				// The settings document has not arrived yet; claiming "unavailable"
				// here would be a lie, and the card fills in on its own.
				if (state.status !== 'ready') return null

				const value = state.value === undefined || state.value === null ? {} : state.value
				const user = state.user === undefined || state.user === null ? {} : state.user
				const writable = state.writable === true

				/** @param {string} field */
				const readField = (field) => {
					const raw = value[field]
					return typeof raw === 'number' || typeof raw === 'boolean' || typeof raw === 'string'
						? raw
						: ''
				}

				/** Queue field writes and report whether the host accepted them. */
				async function commit(writes) {
					setBusy(true)
					setOutcome(null)
					let accepted = true
					try {
						for (const write of writes) {
							if ((await write()) !== true) accepted = false
						}
					} catch {
						accepted = false
					}
					if (accepted) keepOutcome.current = true
					setBusy(false)
					setOutcome(accepted ? 'saved' : 'failed')
				}

				/** Store every field; an empty input clears the profile override. */
				function save() {
					void commit(FORM_FIELDS.map(({ name }) => () => {
						const node = inputs.current[name]
						const next = node === null || node === undefined ? '' : String(node.value).trim()
						if (next === '') return scope.unset(name)
						// Every numeric setting goes through the same guard: a value
						// that is not a non-negative finite number is rejected rather
						// than stored as a string the host would silently ignore.
						if (name === 'minIntervalSec' || name === 'staleAfterSec') {
							const seconds = Number(next)
							if (!Number.isFinite(seconds) || seconds < 0) return Promise.resolve(false)
							return scope.set(name, seconds)
						}
						if (name === 'autoRefresh') return scope.set(name, next === 'true')
						return scope.set(name, next)
					}))
				}

				/**
				 * Render one configuration field.
				 * @param {{ name: string, label: string, hint: string }} spec
				 * @returns {object}
				 */
				const field = (spec) =>
					h(
						'div',
						{ className: 'dsh-balance-field', key: spec.name },
						h(
							'div',
							{ className: 'dsh-balance-fieldhead' },
							h(
								'label',
								{ className: 'dsh-balance-label', htmlFor: `dsh-balance-${spec.name}` },
								t(spec.label),
							),
							Object.hasOwn(user, spec.name)
								? h('span', { className: 'dsh-balance-field-badge' }, t('overridden'))
								: null,
						),
						spec.name === 'autoRefresh'
							? h(
									'div',
									{ className: 'dsh-balance-check' },
									h('input', {
										id: `dsh-balance-${spec.name}`,
										key: `revision-${String(state.revision)}`,
										type: 'checkbox',
										ref: (node) => {
											inputs.current[spec.name] = node
										},
										defaultChecked: readField(spec.name) !== false,
										disabled: !writable || busy,
										onChange: () => {
											setDirty(true)
											setOutcome(null)
										},
									}),
									h('span', { className: 'dsh-balance-hint' }, t(spec.hint)),
								)
							: h(
									'div',
									null,
									h('input', {
										id: `dsh-balance-${spec.name}`,
										className: 'dsh-balance-input',
										key: `revision-${String(state.revision)}`,
										type: 'text',
										ref: (node) => {
											inputs.current[spec.name] = node
										},
										defaultValue: String(readField(spec.name)),
										disabled: !writable || busy,
										spellCheck: false,
										autoComplete: 'off',
										onInput: () => {
											setDirty(true)
											setOutcome(null)
										},
									}),
									h('p', { className: 'dsh-balance-hint' }, t(spec.hint)),
								),
					)

				return h(
					'div',
					{ className: 'dsh-balance-form' },
					h('p', { className: 'dsh-balance-hint' }, t('formHint')),
					writable ? null : h('p', { className: 'dsh-balance-hint', role: 'status' }, t('readOnly')),
					...FORM_FIELDS.map((spec) => field(spec)),
					h(
						'div',
						{ className: 'dsh-balance-foot' },
						h(
							'button',
							{
								type: 'button',
								className: 'dsh-balance-btn',
								disabled: !writable || busy || !dirty,
								onClick: save,
							},
							busy ? t('saving') : t('save'),
						),
						h(
							'button',
							{
								type: 'button',
								className: 'dsh-balance-reset',
								disabled: !writable || busy,
								onClick: () => {
									void commit(FORM_FIELDS.map(({ name }) => () => scope.unset(name)))
								},
							},
							t('reset'),
						),
						outcome === null
							? null
							: h(
									'span',
									{ className: 'dsh-balance-hint', role: 'status' },
									outcome === 'saved' ? t('saved') : t('failed'),
								),
					),
				)
			}
		}

		return {
			/** Cordis services this browser half needs; `slots` is mandatory here. */
			inject: ['slots', 'locale'],
			/** @param {object} ctx */
			apply(ctx) {
				/**
				 * Session model directories, when the runtime provides them. Held in
				 * a closure rather than read per render so a registration made before
				 * the service exists still works once it arrives.
				 */
				let modelDirectories = null
				ctx.inject(['modelDirectories'], (scope) => {
					modelDirectories = scope.modelDirectories
				})

				ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'balance-meter: dictionaries')
				ctx.effect(() => {
					const style = document.createElement('style')
					style.setAttribute('data-plugin', '@zhujiuyi/dsh-balance')
					style.textContent = CSS
					document.head.appendChild(style)
					return () => {
						style.remove()
					}
				}, 'balance-meter: styles')

				// `order: -10` puts the readout to the left of the shipped stats
				// pills, which register on this same row with `order: 0`.
				ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
					name: 'conversation.composer.dock',
					id: 'balance',
					order: -10,
					locale: LOCALE_NS,
					inject: (sessionId) => ({ sessionId, directories: modelDirectories }),
				}, BalanceReadout))

				// A form exists only where the Plugins page can carry one. Without
				// `configForms` this half stays inert rather than rendering a form
				// that could not save.
				ctx.inject(['configForms'], (forms) => {
					const scope = forms.configForms.get(ENTRY_NS)
					ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register(
						{ name: 'plugins.bundle.config', key: '@zhujiuyi/dsh-balance', locale: LOCALE_NS },
						configFormFor(scope),
					))
				})
			},
		}
	},
})
