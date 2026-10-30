'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEMO_SETTINGS = {
  voice: 'Giọng nữ kể chuyện (ấm, chậm)',
  background_video_id: 'bg_demo_cozy',
  watermark: '@3am.diary.demo',
  target_duration: 60,
};

class DemoService {
  constructor({ rootDir, library, workspace }) {
    this.rootDir = rootDir;
    this.assetsDir = path.join(rootDir, 'demo', 'assets');
    this.library = library;
    this.workspace = workspace;
  }

  manifest() {
    const file = path.join(rootDirSafe(this.rootDir), 'demo', 'assets.json');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  postData() {
    return JSON.parse(fs.readFileSync(path.join(this.rootDir, 'demo', 'demo-post.json'), 'utf8'));
  }

  samplePlanRaw() {
    return fs.readFileSync(path.join(this.rootDir, 'demo', 'sample-plan.json'), 'utf8');
  }

  invalidPlanRaw() {
    return fs.readFileSync(path.join(this.rootDir, 'demo', 'invalid-plan.json'), 'utf8');
  }

  async seedLibrary() {
    const manifest = this.manifest();
    const created = [];
    for (const entry of manifest) {
      const sourceFile = path.join(this.assetsDir, entry.file);
      const item = await this.library.importDemoItem({
        id: entry.id,
        kind: entry.kind,
        name: entry.name,
        tags: entry.tags,
        sourceFile,
        mime: entry.mime,
        mediaType: entry.mediaType,
        duration: entry.duration,
      });
      created.push(item);
    }
    return created;
  }

  async load() {
    await this.seedLibrary();
    const data = this.postData();
    await this.workspace.setPostAndComments(data.post, data.comments);
    await this.workspace.setSettings(DEMO_SETTINGS);
    return {
      post: data.post,
      comments: data.comments,
      settings: DEMO_SETTINGS,
    };
  }
}

function rootDirSafe(rootDir) {
  return rootDir;
}

module.exports = { DemoService, DEMO_SETTINGS };
