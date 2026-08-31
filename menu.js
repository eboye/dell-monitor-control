// The control menu: builds the items, tracks monitor state, applies changes.
//
// Deliberately not a widget. It writes into whatever PopupMenu container it is
// handed, so the same logic backs both the top-bar button and the Quick
// Settings tile — see extension.js.

import GLib from 'gi://GLib';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';

import {
    VCP, INPUT, PRESET, MODE, POWER_OFF,
    INPUT_LABELS, PRESET_LABELS, MODE_LABELS,
    labelFor, createModel,
} from './monitor.js';

const ERROR_TEXT = {
    NO_DDCUTIL: 'ddcutil not found — install it.',
    NO_MONITOR: 'No DDC/CI monitor detected.',
    COMM_FAILED: 'Monitor not responding (check DDC/CI in OSD).',
};

// The pick-one control groups. Rendered inline (with a header separator) when
// `submenu` is absent, or inside a submenu when it's set. Drives both menu
// construction and active-marking, so adding a control is a one-line change.
const CONTROL_GROUPS = [
    { key: 'input', vcp: VCP.INPUT, header: 'Input',
      codes: [INPUT.DP1, INPUT.HDMI1, INPUT.USBC], labels: INPUT_LABELS },
    { key: 'preset', vcp: VCP.PRESET, submenu: 'Color preset',
      codes: [PRESET.K6500, PRESET.K9300, PRESET.USER1, PRESET.USER2], labels: PRESET_LABELS },
    { key: 'mode', vcp: VCP.MODE, submenu: 'Display mode',
      codes: [MODE.STANDARD, MODE.MOVIE, MODE.GAMES], labels: MODE_LABELS },
];

// Debounce for scroll/keyboard slider changes before writing to the monitor.
const SLIDER_APPLY_MS = 300;

const GROUP_INPUT = CONTROL_GROUPS[0];
const GROUP_SUBMENUS = CONTROL_GROUPS.filter(g => g.submenu);

export class MonitorMenu {
    // `onModel` is called with the detected model name (or null when the
    // monitor becomes unavailable) so a host can show it in a menu header.
    constructor(ddc, menu, { onModel } = {}) {
        this._ddc = ddc;
        this._menu = menu;
        this._onModel = onModel ?? null;
        this._model = createModel();
        this._powerConfirm = false;
        this._powerTimeoutId = 0;
        this._destroyed = false;
        this._refreshing = false;
        this._suppressSliderApply = false;
        this._sliderApplyIds = new Map();
        this._groupItems = {};

        this._buildMenu();
        this._openStateId = menu.connect('open-state-changed', (_m, open) => {
            if (open)
                this._refresh();
        });

        // Initial detect + populate.
        this._detectThenRefresh();
    }

    _buildMenu() {
        this._resetPower();
        this._menu.removeAll();

        if (!this._model.available) {
            if (this._model.error === null) {
                const detecting = new PopupMenu.PopupMenuItem('Detecting monitor…', { reactive: false });
                this._menu.addMenuItem(detecting);
                return;
            }
            const item = new PopupMenu.PopupMenuItem(this._errorText(), { reactive: false });
            this._menu.addMenuItem(item);
            const retry = new PopupMenu.PopupMenuItem('Retry');
            retry.connect('activate', () => this._detectThenRefresh());
            this._menu.addMenuItem(retry);
            return;
        }

        // --- Input source (inline) ---
        this._groupItems = {};
        this._addControlGroup(GROUP_INPUT);

        // --- Brightness / Contrast sliders ---
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Brightness'));
        this._brightnessSlider = this._addSlider(VCP.BRIGHTNESS);
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Contrast'));
        this._contrastSlider = this._addSlider(VCP.CONTRAST);

        // --- Color preset / Display mode (submenus) ---
        for (const group of GROUP_SUBMENUS)
            this._addControlGroup(group);

        // --- Power off (two-step confirm) ---
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._powerItem = new PopupMenu.PopupMenuItem('Power off display');
        this._powerItem.connect('activate', () => this._onPowerActivate());
        this._menu.addMenuItem(this._powerItem);

        // --- Refresh ---
        const refresh = new PopupMenu.PopupMenuItem('Refresh');
        refresh.connect('activate', () => this._refresh());
        this._menu.addMenuItem(refresh);
    }

    // Build one pick-one control group (input / preset / mode) from CONTROL_GROUPS.
    _addControlGroup(group) {
        let container;
        if (group.submenu) {
            const sub = new PopupMenu.PopupSubMenuMenuItem(group.submenu);
            this._menu.addMenuItem(sub);
            container = sub.menu;
        } else {
            this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(group.header));
            container = this._menu;
        }
        const items = new Map();
        for (const code of group.codes) {
            const item = new PopupMenu.PopupMenuItem(labelFor(group.labels, code));
            item.connect('activate', () => this._set(group.vcp, code, group.key));
            items.set(code, item);
            container.addMenuItem(item);
        }
        this._groupItems[group.key] = items;
    }

    _addSlider(code) {
        const item = new PopupMenu.PopupBaseMenuItem({ activate: false });
        const slider = new Slider.Slider(0);
        // Pointer drag: apply once, when the drag settles.
        slider.connect('drag-begin', () => { slider._dmcDragging = true; });
        slider.connect('drag-end', () => {
            slider._dmcDragging = false;
            this._applySlider(code, slider);
        });
        // Scroll and keyboard change the value without a drag; debounce so a run
        // of steps collapses into a single write, and ignore our own _render()
        // writes (guarded by _suppressSliderApply) to avoid echoing them back.
        slider.connect('notify::value', () => {
            if (slider._dmcDragging || this._suppressSliderApply)
                return;
            this._scheduleSliderApply(code, slider);
        });
        item.add_child(slider);
        this._menu.addMenuItem(item);
        return slider;
    }

    _scheduleSliderApply(code, slider) {
        const existing = this._sliderApplyIds.get(code);
        if (existing)
            GLib.Source.remove(existing);
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SLIDER_APPLY_MS, () => {
            this._sliderApplyIds.delete(code);
            this._applySlider(code, slider);
            return GLib.SOURCE_REMOVE;
        });
        this._sliderApplyIds.set(code, id);
    }

    _applySlider(code, slider) {
        const value = Math.round(slider.value * 100);
        this._set(code, value, code === VCP.BRIGHTNESS ? 'brightness' : 'contrast');
    }

    _errorText() {
        return ERROR_TEXT[this._model.error] ?? 'Monitor unavailable.';
    }

    // Move the model into the unavailable/error state and rebuild the menu.
    _fail(e) {
        this._model.available = false;
        this._model.error = e.code ?? 'UNKNOWN';
        this._onModel?.(null);
        this._buildMenu();
    }

    async _detectThenRefresh() {
        try {
            const info = await this._ddc.detect();
            if (this._destroyed)
                return;
            this._model.available = true;
            this._model.error = null;
            this._model.bus = info.bus;
            this._model.model = info.model;
            this._onModel?.(info.model);
            this._buildMenu();
            await this._refresh();
        } catch (e) {
            if (!this._destroyed)
                this._fail(e);
        }
    }

    async _refresh() {
        if (!this._model.available || this._refreshing)
            return;
        this._refreshing = true;
        try {
            const all = await this._ddc.getAll();
            if (this._destroyed)
                return;
            // Keep last-known-good for any field the reply didn't include (null).
            for (const [key, value] of Object.entries(all)) {
                if (value !== null)
                    this._model[key] = value;
            }
            this._render();
        } catch (e) {
            if (!this._destroyed)
                this._fail(e);
        } finally {
            this._refreshing = false;
        }
    }

    _render() {
        this._suppressSliderApply = true;
        try {
            if (this._brightnessSlider && this._model.brightness !== null)
                this._brightnessSlider.value = this._model.brightness / 100;
            if (this._contrastSlider && this._model.contrast !== null)
                this._contrastSlider.value = this._model.contrast / 100;
        } finally {
            this._suppressSliderApply = false;
        }
        for (const group of CONTROL_GROUPS)
            this._markActive(this._groupItems[group.key], this._model[group.key]);
    }

    _markActive(items, activeCode) {
        if (!items)
            return;
        for (const [code, item] of items) {
            item.setOrnament(code === activeCode
                ? PopupMenu.Ornament.DOT
                : PopupMenu.Ornament.NONE);
        }
    }

    async _set(code, value, key) {
        try {
            await this._ddc.setVcp(code, value);
            if (this._destroyed)
                return;
            this._model[key] = value;
            this._render();
        } catch (e) {
            if (!this._destroyed)
                Main.notify('Dell Monitor Control', 'Failed to apply change.');
        }
    }

    _onPowerActivate() {
        if (!this._powerConfirm) {
            this._powerConfirm = true;
            this._powerItem.label.text = 'Confirm power off';
            this._powerTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 4, () => {
                this._resetPower();
                return GLib.SOURCE_REMOVE;
            });
            return;
        }
        this._resetPower();
        this._set(VCP.POWER, POWER_OFF, 'power');
    }

    _resetPower() {
        this._powerConfirm = false;
        if (this._powerItem)
            this._powerItem.label.text = 'Power off display';
        if (this._powerTimeoutId) {
            GLib.Source.remove(this._powerTimeoutId);
            this._powerTimeoutId = 0;
        }
    }

    destroy() {
        this._destroyed = true;
        this._onModel = null;
        if (this._powerTimeoutId) {
            GLib.Source.remove(this._powerTimeoutId);
            this._powerTimeoutId = 0;
        }
        for (const id of this._sliderApplyIds.values())
            GLib.Source.remove(id);
        this._sliderApplyIds.clear();
        if (this._openStateId) {
            this._menu.disconnect(this._openStateId);
            this._openStateId = 0;
        }
        this._brightnessSlider = null;
        this._contrastSlider = null;
        this._powerItem = null;
        this._groupItems = {};
    }
}
