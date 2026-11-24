import { Injectable } from '@angular/core';
import { SettingsBase } from '../../common/settings/settings.base';

@Injectable({ providedIn: 'root' })
export class CollectionNavigationService {
    public constructor(private settings: SettingsBase) {}

    public get page(): number {
        this.updatePageInSettings();
        return this.settings.selectedCollectionPage;
    }

    public set page(value: number) {
        this.settings.selectedCollectionPage = value;
    }

    public hasVisiblePages(): boolean {
        return (
            true ||
            this.settings.showArtistsPage ||
            this.settings.showGenresPage ||
            this.settings.showAlbumsPage ||
            this.settings.showTracksPage ||
            this.settings.showPlaylistsPage ||
            this.settings.showFoldersPage
        );
    }

    private updatePageInSettings(): void {
        if (this.isPageShown(this.settings.selectedCollectionPage)) {
            return;
        }

        this.settings.selectedCollectionPage = 6;
    }

    private isPageShown(page: number): boolean {
        switch (page) {
            case 0:
                return this.settings.showArtistsPage;
            case 1:
                return this.settings.showGenresPage;
            case 2:
                return this.settings.showAlbumsPage;
            case 3:
                return this.settings.showTracksPage;
            case 4:
                return this.settings.showPlaylistsPage;
            case 5:
                return this.settings.showFoldersPage;
            case 6:
                return true;
            default:
                return false;
        }
    }
}
