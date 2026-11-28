import { Injectable } from '@angular/core';
import { GitHubApi } from '../../common/api/git-hub/git-hub.api';
import { ProductInformation } from '../../common/application/product-information';
import { Logger } from '../../common/logger';
import { VersionComparer } from './version-comparer';
import { UpdateServiceBase } from './update.service.base';
import { DesktopBase } from '../../common/io/desktop.base';
import { SettingsBase } from '../../common/settings/settings.base';
@Injectable()
export class UpdateService implements UpdateServiceBase {
    public _isUpdateAvailable: boolean = false;
    private _latestRelease: string = '';

    public constructor(
        private settings: SettingsBase,
        private logger: Logger,
        private gitHub: GitHubApi,
        private desktop: DesktopBase,
    ) {}

    public get isUpdateAvailable(): boolean {
        return this._isUpdateAvailable;
    }

    public get latestRelease(): string {
        return this._latestRelease;
    }

    public async checkForUpdatesAsync(): Promise<void> {
        this.logger.info('Not checking for updates', 'UpdateService', 'checkForUpdatesAsync');
        return;
    }

    public async downloadLatestReleaseAsync(): Promise<void> {
        await this.desktop.openLinkAsync(
            `https://github.com/digimezzo/${ProductInformation.applicationName.toLowerCase()}/releases/tag/v${this.latestRelease}`,
        );
    }
}
