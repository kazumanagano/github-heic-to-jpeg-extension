/**
 * テスト用にmanifest.jsonを修正するスクリプト
 * file://プロトコルでもcontent_scriptsが動作するようにする
 */
import fs from 'fs';
import path from 'path';

const MANIFEST_PATH = path.resolve('./dist/manifest.json');
const BACKUP_PATH = path.resolve('./dist/manifest.json.backup');

export function enableTestMode() {
	// バックアップを作成
	const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
	fs.writeFileSync(BACKUP_PATH, JSON.stringify(manifest, null, 2));

	// file://とlocalhost用のマッチパターンを追加（ポート番号付きも必要）
	manifest.content_scripts[0].matches.push(
		'file:///*',
		'http://localhost/*',
		'http://localhost:3333/*',
		'http://127.0.0.1/*',
		'http://127.0.0.1:3333/*'
	);

	fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
	console.log('Test mode enabled: Added file:// and localhost to content_scripts matches');
}

export function disableTestMode() {
	if (fs.existsSync(BACKUP_PATH)) {
		fs.copyFileSync(BACKUP_PATH, MANIFEST_PATH);
		fs.unlinkSync(BACKUP_PATH);
		console.log('Test mode disabled: Restored original manifest.json');
	}
}

// CLI実行用
const args = process.argv.slice(2);
if (args[0] === 'enable') {
	enableTestMode();
} else if (args[0] === 'disable') {
	disableTestMode();
}
