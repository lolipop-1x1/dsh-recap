export const styles = `
/* 旧回顾行仍由宿主管理，只移除本插件空命令行累积的外层间距。 */
[data-chat-flow-kind="command"]:has([data-dshr-command]:empty){display:none}

.dshr-recap,.dshr-settings{--r-line:var(--dsw-alias-border-l4,ButtonBorder);--r-bg:var(--dsw-alias-bg-layer-1,Canvas);--r-text:var(--dsw-alias-label-primary,CanvasText);--r-muted:var(--dsw-alias-label-tertiary,GrayText);color:var(--r-text);font:inherit;box-sizing:border-box}
.dshr-recap{width:100%;min-width:0;padding:2px 0;color:var(--r-muted)}
.dshr-recap-toggle{display:flex;align-items:flex-start;width:100%;padding:0;border:0;border-radius:var(--dsw-radius-sm);appearance:none;background:transparent;color:inherit;font:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(24px + var(--dsh-content-font-delta,0px));text-align:left;cursor:pointer}
.dshr-recap-toggle:hover{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}
.dshr-recap-icon{width:calc(16px + var(--dsh-content-font-delta,0px));height:calc(24px + var(--dsh-content-font-delta,0px));display:inline-grid;place-items:center;flex:none;margin-right:6px}
.dshr-recap-icon svg{width:calc(14px + var(--dsh-content-font-delta,0px));height:calc(14px + var(--dsh-content-font-delta,0px))}
.dshr-recap-prefix{white-space:nowrap;flex:none}.dshr-kind{font:inherit}
.dshr-recap-separator{width:2px;height:2px;flex:none;background:var(--dsw-alias-label-caption,currentColor);margin:calc(11px + var(--dsh-content-font-delta,0px)/2) 8px 0;border-radius:1px}
.dshr-summary{min-width:0;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}
.dshr-summary[data-expanded=true]{display:block;overflow:visible}
.dshr-command-note{margin:8px 0;font-size:var(--dsh-content-font-size-secondary,13px);color:var(--dsw-alias-label-tertiary,GrayText);overflow-wrap:anywhere}
.dshr-button:hover{background:color-mix(in srgb,currentColor 7%,transparent)}
.dshr-recap button:focus-visible,.dshr-settings :is(button,input,select):focus-visible{outline:2px solid Highlight;outline-offset:2px}
.dshr-settings button:disabled{opacity:.4;cursor:not-allowed}
.dshr-alert{margin:8px 12px;padding:10px 12px;border-left:3px solid currentColor;border-radius:4px;background:color-mix(in srgb,currentColor 5%,transparent);font-size:12px}
.dshr-button{font:inherit;color:inherit;background:transparent;border:1px solid var(--r-line);border-radius:7px;padding:7px 12px;cursor:pointer}.dshr-primary{font-weight:500;background:var(--dsw-alias-bg-accent,Highlight);color:var(--dsw-alias-label-onAccent,HighlightText);border-color:transparent;font-size:13px;padding:6px 14px}.dshr-text-button{border:0;background:transparent;color:var(--r-muted);font:inherit;font-size:12px;padding:5px 0;cursor:pointer}.dshr-text-button:hover{color:var(--r-text)}
.dshr-settings{max-width:760px;padding:8px 4px 24px;margin:auto}.dshr-settings-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:8px 0 12px}.dshr-settings-heading [role=status]{font-size:12px;color:var(--r-muted)}.dshr-settings h2{font-size:22px;margin:0}.dshr-subtitle{color:var(--r-muted);margin:0 0 18px}.dshr-note{font-size:13px;line-height:1.7;padding:12px 14px;border:1px solid var(--r-line);border-radius:9px}
.dshr-settings fieldset{margin:22px 0;border:1px solid var(--r-line);border-radius:10px;padding:4px 16px}.dshr-settings legend{padding:0 8px;font-size:14px;font-weight:600}
.dshr-field{display:flex;align-items:center;justify-content:space-between;gap:22px;padding:14px 0;border-bottom:1px solid color-mix(in srgb,var(--r-line) 55%,transparent)}.dshr-field:last-child{border:0}
.dshr-field label{font-size:13px;font-weight:500}.dshr-field p{font-size:12px;color:var(--r-muted);margin:4px 0 0;line-height:1.5;max-width:390px}
.dshr-field input:not([type=checkbox]),.dshr-field select{font:inherit;font-size:13px;color:inherit;background:var(--r-bg);border:1px solid var(--r-line);border-radius:6px;min-width:0;width:190px;padding:7px 8px;flex-shrink:0}.dshr-field input[type=number]{width:105px}.dshr-field input[type=checkbox]{width:18px;height:18px;cursor:pointer;flex-shrink:0}
.dshr-setting-actions{display:flex;justify-content:flex-end;margin:12px 0}
.dshr-settings-dialog{box-sizing:border-box;width:min(850px,95vw);max-height:85vh;overflow:auto;border:1px solid var(--dsw-alias-border-l4,ButtonBorder);border-radius:12px;background:var(--dsw-alias-bg-layer-1,Canvas);color:var(--dsw-alias-label-primary,CanvasText);padding:16px}.dshr-settings-dialog::backdrop{background:#0008}
@media(max-width:520px){.dshr-field{align-items:flex-start;gap:12px}.dshr-field input:not([type=checkbox]),.dshr-field select{width:125px}.dshr-settings fieldset{padding:4px 10px}}
`
