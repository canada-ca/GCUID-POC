/*!
 * GCUID — Government of Canada Unique Identifier System
 *
 * @license
 * Copyright (c) 2024-2026 NOETRONIQ Strategic Initiatives. All rights reserved.
 * Author: Philippe R. Beauchamp <prb@noetroniq.com>
 *
 * Licensed for use and modification by the Treasury Board of Canada Secretariat.
 * See LICENSE in the project root for full terms.
 */
/**
 * Build version resolver.
 *
 * Reads `staging/version.json` at module load time and exposes its
 * components as named exports. Every release updates `version.json`
 * and these exports reflect the running build.
 *
 * `BUILD_VERSION` is the dotted `major.minor.build` string used in
 * the `/health` response and in the build banner at startup.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const versionPath = resolve(__dirname, '../../version.json');

/** Shape of `staging/version.json`. */
interface VersionFile {
  major: number;
  minor: number;
  build: number;
  releaseDate: string;
}

const v: VersionFile = JSON.parse(readFileSync(versionPath, 'utf8'));

/** Dotted build version, e.g. `"1.2.3"`. */
export const BUILD_VERSION  = `${v.major}.${v.minor}.${v.build}`;

/** Major version number. */
export const BUILD_MAJOR    = v.major;

/** Minor version number. */
export const BUILD_MINOR    = v.minor;

/** Build (patch) number. */
export const BUILD_NUMBER   = v.build;

/** ISO-8601 release date of this build. */
export const RELEASE_DATE   = v.releaseDate;
