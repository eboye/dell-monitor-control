import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { Ddcutil } from './ddcutil.js';
import {
    VCP, INPUT, PRESET, MODE, POWER_OFF,
    INPUT_LABELS, PRESET_LABELS, MODE_LABELS,
    labelFor, createModel,
} from './monitor.js';

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init(ddc) {
        super._init(0.0, 'Dell Monitor Control');
        this._ddc = ddc;
        this._model = createModel();
        this._powerConfirm = false;
        this._powerTimeoutId = 0;

        this.add_child(new St.Icon({
            icon_name: 'video-display-symbolic',
            style_class: 'system-status-icon',
        }));

        this._buildMenu();
        this.menu.connect('open-state-changed', (_m, open) => {
            if (open)
                this._refresh();
        });

        // Initial detect + populate.
        this._detectThenRefresh();
    }

    _buildMenu() {
        this.menu.removeAll();

        if (!this._model.available) {
            const item = new PopupMenu.PopupMenuItem(this._errorText(), { reactive: false });
            this.menu.addMenuItem(item);
            const retry = new PopupMenu.PopupMenuItem('Retry');
            retry.connect('activate', () => this._detectThenRefresh());
            this.menu.addMenuItem(retry);
            return;
        }

        // --- Input source ---
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Input'));
        this._inputItems = new Map();
        for (const code of [INPUT.DP1, INPUT.HDMI1, INPUT.USBC]) {
            const item = new PopupMenu.PopupMenuItem(labelFor(INPUT_LABELS, code));
            item.connect('activate', () => this._set(VCP.INPUT, code, 'input'));
            this._inputItems.set(code, item);
            this.menu.addMenuItem(item);
        }

        // --- Brightness slider ---
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Brightness'));
        this._brightnessSlider = this._addSlider(VCP.BRIGHTNESS, 'brightness');

        // --- Contrast slider ---
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Contrast'));
        this._contrastSlider = this._addSlider(VCP.CONTRAST, 'contrast');

        // --- Color preset submenu ---
        const presetMenu = new PopupMenu.PopupSubMenuMenuItem('Color preset');
        this._presetItems = new Map();
        for (const code of [PRESET.K6500, PRESET.K9300, PRESET.USER1, PRESET.USER2]) {
            const item = new PopupMenu.PopupMenuItem(labelFor(PRESET_LABELS, code));
            item.connect('activate', () => this._set(VCP.PRESET, code, 'preset'));
            this._presetItems.set(code, item);
            presetMenu.menu.addMenuItem(item);
        }
        this.menu.addMenuItem(presetMenu);

        // --- Display mode submenu ---
        const modeMenu = new PopupMenu.PopupSubMenuMenuItem('Display mode');
        this._modeItems = new Map();
        for (const code of [MODE.STANDARD, MODE.MOVIE, MODE.GAMES]) {
            const item = new PopupMenu.PopupMenuItem(labelFor(MODE_LABELS, code));
            item.connect('activate', () => this._set(VCP.MODE, code, 'mode'));
            this._modeItems.set(code, item);
            modeMenu.menu.addMenuItem(item);
        }
        this.menu.addMenuItem(modeMenu);

        // --- Power off (two-step confirm) ---
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._powerItem = new PopupMenu.PopupMenuItem('Power off display');
        this._powerItem.connect('activate', () => this._onPowerActivate());
        this.menu.addMenuItem(this._powerItem);

        // --- Refresh ---
        const refresh = new PopupMenu.PopupMenuItem('Refresh');
        refresh.connect('activate', () => this._refresh());
        this.menu.addMenuItem(refresh);
    }

    _addSlider(code, key) {
        const item = new PopupMenu.PopupBaseMenuItem({ activate: false });
        const slider = new imports.ui.slider.Slider(0);
        // Apply only when the drag/scroll interaction settles.
        slider.connect('drag-end', () => this._applySlider(code, slider));
        slider.connect('scroll-event', () => {});
        item.add_child(slider);
        this.menu.addMenuItem(item);
        return slider;
    }

    _applySlider(code, slider) {
        const value = Math.round(slider.value * 100);
        this._set(code, value, code === VCP.BRIGHTNESS ? 'brightness' : 'contrast');
    }

    _errorText() {
        const map = {
            NO_DDCUTIL: 'ddcutil not found — install it.',
            NO_MONITOR: 'No DDC/CI monitor detected.',
            COMM_FAILED: 'Monitor not responding (check DDC/CI in OSD).',
        };
        return map[this._model.error] ?? 'Monitor unavailable.';
    }

    async _detectThenRefresh() {
        try {
            const info = await this._ddc.detect();
            this._model.available = true;
            this._model.error = null;
            this._model.bus = info.bus;
            this._model.model = info.model;
            this._buildMenu();
            await this._refresh();
        } catch (e) {
            this._model.available = false;
            this._model.error = e.code ?? 'UNKNOWN';
            this._buildMenu();
        }
    }

    async _refresh() {
        if (!this._model.available)
            return;
        try {
            const all = await this._ddc.getAll();
            Object.assign(this._model, all);
            this._render();
        } catch (e) {
            this._model.available = false;
            this._model.error = e.code ?? 'UNKNOWN';
            this._buildMenu();
        }
    }

    _render() {
        if (this._brightnessSlider && this._model.brightness !== null)
            this._brightnessSlider.value = this._model.brightness / 100;
        if (this._contrastSlider && this._model.contrast !== null)
            this._contrastSlider.value = this._model.contrast / 100;
        this._markActive(this._inputItems, this._model.input);
        this._markActive(this._presetItems, this._model.preset);
        this._markActive(this._modeItems, this._model.mode);
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
            this._model[key] = value;
            this._render();
        } catch (e) {
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
        if (this._powerTimeoutId) {
            GLib.Source.remove(this._powerTimeoutId);
            this._powerTimeoutId = 0;
        }
        super.destroy();
    }
});

export default class DellMonitorControlExtension extends Extension {
    enable() {
        this._ddc = new Ddcutil();
        this._indicator = new Indicator(this._ddc);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
        this._ddc = null;
    }
}
