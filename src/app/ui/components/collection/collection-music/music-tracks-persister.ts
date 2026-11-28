import { Injectable } from '@angular/core';
import { Logger } from '../../../../common/logger';
import { BaseTracksPersister } from '../base-tracks-persister';
import { SettingsBase } from '../../../../common/settings/settings.base';
import { TrackOrder } from '../track-order';

@Injectable()
export class MusicTracksPersister extends BaseTracksPersister {
    public constructor(
        public settings: SettingsBase,
        public logger: Logger,
    ) {
        super(settings, logger);
        this.defaultTrackOrder = TrackOrder.none;
    }

    public override getSelectedTrackOrder(): TrackOrder {
        return TrackOrder.none;
    }

    public getSelectedTrackOrderFromSettings(): string {
        return 'none';
    }

    public saveSelectedTrackOrderToSettings(selectedTrackOrderName: string): void {
        // No-op: el panel de música conserva el orden suministrado
    }
}
