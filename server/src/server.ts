import {
	createConnection,
	TextDocuments,
	DiagnosticSeverity,
	Diagnostic,
	ProposedFeatures,
	InitializeParams,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	InitializeResult,
	Position,
} from 'vscode-languageserver';

import {
	TextDocument
} from 'vscode-languageserver-textdocument';
import { spawn, ChildProcess } from 'child_process';

const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);
const connection = createConnection(ProposedFeatures.all);

connection.onInitialize((_: InitializeParams) => {
	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			completionProvider: {
				resolveProvider: true,
			},
		},
	};

	return result;
});

let documentLangServers: Map<string, ChildProcess> = new Map();

documents.onDidClose(e => {
	if (documentLangServers.has(e.document.uri)) {
		const serverProcess = documentLangServers.get(e.document.uri);

		if (serverProcess) {
			serverProcess.kill('SIGINT');
		}

		documentLangServers.delete(e.document.uri);
	}
});

documents.onDidChangeContent(async change => {
	const textDocument = change.document;

	if (documentLangServers.has(textDocument.uri)) {
		const serverProcess = documentLangServers.get(textDocument.uri);

		if (serverProcess) {
			serverProcess.kill('SIGINT');
		}

		documentLangServers.delete(textDocument.uri);
	}

	const text = textDocument.getText();
	const buffer: any[] = [];

	const serverProcess = spawn('F:/Projects/qscript-language/Debug/LangSrv.exe', ['--exit']);

	if (serverProcess.pid) {
		serverProcess.stdout.on('data', (data) => {
			buffer.push(data);
		});

		serverProcess.stdout.on('end', () => {
			if (buffer.length === 0) {
				return;
			}

			const diagnostics: Diagnostic[] = [];

			const serverResult = buffer.join('');
			for (const line of serverResult.split('\n')) {
				if (line === 'OK') {
					break;
				}

				const errorCode = line.match(/(?<=\[)([A-z\_]+)/);

				if (!errorCode) {
					continue;
				}

				const lineNr = line.match(/(?<=(\[[A-z]+,))(\d+)/);

				if (!lineNr) {
					continue;
				}

				const colNr = line.match(/(?<=(\[[A-z]+\,\d+,))(\d+)/);

				if (!colNr) {
					continue;
				}

				const tokenLen = line.match(/(?<=(\[[A-z]+\,\d+\,\d+\,))(\d+)/);

				if (!tokenLen) {
					continue;
				}

				let lineNumber, colNumber, tokenLength;

				try {
					lineNumber = Number.parseInt(lineNr[ 0 ], 10);
					colNumber = Number.parseInt(colNr[ 0 ], 10);
					tokenLength = Number.parseInt(tokenLen[ 0 ], 10);
				} catch (err) {
					console.error('Error parsing line/column number: ', err);
					continue;
				}

				const diagnostic: Diagnostic = {
					severity: DiagnosticSeverity.Warning,
					range: {
						start: Position.create(lineNumber - 1, colNumber),
						end: Position.create(lineNumber - 1, colNumber + tokenLength),
					},
					message: line.split(']:').slice(1).join(''),
					source: 'Q-Script'
				};
	
				diagnostics.push(diagnostic);
			}

			console.log(`${textDocument.uri}:\n${diagnostics.map((d) =>
				`\t(${d.range.start.line}, ${d.range.start.character}): ${d.message}`)}`);

			connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
		});

		serverProcess.on('close', () => documentLangServers.delete(textDocument.uri));

		documentLangServers.set(textDocument.uri, serverProcess);

		serverProcess.stdin.write(text);
		serverProcess.stdin.end();
	}
});

connection.onCompletion((_: TextDocumentPositionParams): CompletionItem[] => {
	return [
		{
			label: 'const',
			kind: CompletionItemKind.Text,
			data: 1
		},
		{
			label: 'var',
			kind: CompletionItemKind.Text,
			data: 2
		}
	];
});

connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
	if (item.data === 1) {
		item.detail = 'CONST';
		item.documentation = 'const - create\'s an immutable variable';
	} else if (item.data === 2) {
		item.detail = 'VAR';
		item.documentation = 'var - create\'s a mutable variable';
	}
	return item;
});

documents.listen(connection);
connection.listen();
