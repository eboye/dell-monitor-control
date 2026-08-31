import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { Ddcutil } from './ddcutil.js';
import { MonitorMenu } from './menu.js';

const TITLE = 'Dell Monitor Control';
const TILE_TITLE = 'Dell Monitor';
const ICON = 'video-display-symbolic';

// --- Top bar: a status-area button owning the menu. -------------------------

const PanelIndicator = GObject.registerClass(
class PanelIndicator extends PanelMenu.Button {
    _init(ddc) {
        super._init(0.0, TITLE);

        this.add_child(new St.Icon({
            icon_name: ICON,
            style_class: 'system-status-icon',
        }));

        this._controls = new MonitorMenu(ddc, this.menu);
    }

    destroy() {
        this._controls.destroy();
        this._controls = null;
        super.destroy();
    }
});

// --- Quick Settings: a tile whose body and arrow both open the menu. --------

const MonitorToggle = GObject.registerClass(
class MonitorToggle extends QuickSettings.QuickMenuToggle {
    _init(ddc) {
        super._init({
            // A half-width tile ellipsizes a long title, so keep it short and
            // let the detected model fill the subtitle.
            title: TILE_TITLE,
            iconName: ICON,
            // Nothing to switch on and off — the tile is a menu opener, so a
            // stray click can't blank the display.
            toggleMode: false,
            checked: true,
        });

        this.menu.setHeader(ICON, TITLE, '');
        this._controls = new MonitorMenu(ddc, this.menu, {
            onModel: model => {
                this.subtitle = model ?? '';
                this.menu.setHeader(ICON, TITLE, model ?? '');
            },
        });

        this.connect('clicked', () => this.menu.open());
    }

    destroy() {
        this._controls.destroy();
        this._controls = null;
        super.destroy();
    }
});

const QsIndicator = GObject.registerClass(
class QsIndicator extends QuickSettings.SystemIndicator {
    _init(ddc) {
        super._init();
        this.quickSettingsItems.push(new MonitorToggle(ddc));
    }

    destroy() {
        // SystemIndicator.destroy() doesn't touch quickSettingsItems, so the
        // tile has to be destroyed here or it survives in the grid. Splicing
        // first keeps that safe if a shell version ever does destroy them.
        const items = this.quickSettingsItems.splice(0);
        for (const item of items)
            item.destroy();
        super.destroy();
    }
});

export default class DellMonitorControlExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._settingsId = this._settings.connect('changed::use-quick-settings',
            () => this._rebuild());
        this._build();
    }

    disable() {
        if (this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = 0;
        }
        this._settings = null;
        this._teardown();
    }

    _build() {
        this._ddc = new Ddcutil();
        if (this._settings.get_boolean('use-quick-settings')) {
            this._indicator = new QsIndicator(this._ddc);
            Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
        } else {
            this._indicator = new PanelIndicator(this._ddc);
            Main.panel.addToStatusArea(this.uuid, this._indicator);
        }
    }

    // Abort any in-flight ddcutil call so its callback can't fire on the
    // destroyed indicator, then tear the indicator down.
    _teardown() {
        this._ddc?.cancel();
        this._indicator?.destroy();
        this._indicator = null;
        this._ddc = null;
    }

    // Swap surfaces in place when the preference changes, so the user doesn't
    // have to reload the shell to see it take effect.
    _rebuild() {
        this._teardown();
        this._build();
    }
}
