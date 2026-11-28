import { Injectable } from '@angular/core';
import { LastfmAlbum } from '../../common/api/lastfm/lastfm-album';
import { LastfmApi } from '../../common/api/lastfm/lastfm.api';
import { ImageProcessor } from '../../common/image-processor';
import { Logger } from '../../common/logger';
import { IFileMetadata } from '../../common/metadata/i-file-metadata';
import { StringUtils } from '../../common/utils/string-utils';

@Injectable()
export class OnlineAlbumArtworkGetter {
    public constructor(
        private imageProcessor: ImageProcessor,
        private lastfmApi: LastfmApi,
        private logger: Logger,
    ) {}

    public async getOnlineArtworkAsync(_fileMetadata: IFileMetadata | undefined): Promise<Buffer | undefined> {
        return undefined;
    }
}
