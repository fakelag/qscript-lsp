import * as path from 'path';
import { workspace, ExtensionContext } from 'vscode';

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient';

let client: LanguageClient;

const activate = (context: ExtensionContext) => {
	const serverModule = context.asAbsolutePath(
		path.join('server', 'out', 'server.js')
	);

	const serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: { execArgv: ['--nolazy', '--inspect=6009'] },
		}
	};

	const clientOptions: LanguageClientOptions = {
		// Select qs files only
		documentSelector: [{ scheme: 'file', language: 'qscript' }],
		synchronize: {
			fileEvents: workspace.createFileSystemWatcher('**/.clientrc')
		}
	};

	client = new LanguageClient(
		'qscript-language',
		'Q-Script Language',
		serverOptions,
		clientOptions,
	);

	client.start();
};

const deactivate = (): Thenable<void> | undefined => {
	if (!client) {
		return undefined;
	}
	return client.stop();
};

export { activate, deactivate };
