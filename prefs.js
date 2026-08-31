import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class DellMonitorControlPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const group = new Adw.PreferencesGroup({
            title: 'Placement',
            description: 'Where the monitor controls appear in the shell.',
        });

        const row = new Adw.SwitchRow({
            title: 'Show in Quick Settings',
            subtitle: 'Use a Quick Settings tile instead of a separate top-bar icon.',
        });
        settings.bind('use-quick-settings', row, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(row);

        const page = new Adw.PreferencesPage();
        page.add(group);
        window.add(page);
    }
}
