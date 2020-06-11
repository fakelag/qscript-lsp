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
	Hover,
	Range,
} from 'vscode-languageserver';

import {
	TextDocument
} from 'vscode-languageserver-textdocument';
import { spawn, ChildProcess } from 'child_process';

type ModuleFunctionArg = {
	name: string;
	type: string;
	returnType: string;
	isVarArgs: boolean;
}

type ModuleFunction = {
	name: string;
	returnType: string;
	args: ModuleFunctionArg[];
};

type JmpAttributes = {
	jumpTo?: number;
	relative?: number;
	dir?: -1 | 1;
}

type ClosureAttributes = {
	upvalueIndex?: number;
	isLocal?: boolean;
}

type OpcodeAttributes = JmpAttributes & ClosureAttributes & {
	type: string;
}

type Disassembly = {
	id: number;
	name: string;
	opcodes: Array<{
		full: string;
		address: string;
		lineNr: number;
		colNr: number;
		token: string;
		type: 'SIMPLE' | 'LONG' | 'SHORT';
		size: number;
		attributes?: OpcodeAttributes[];
	}>;
}

type LangServerResult = {
	status: 'OK' | 'failed';
	errors: Array<{
		lineNr: number;
		colNr: number;
		token: string;
		desc: string;
		generic?: boolean;
	}>;
	symbols: Array<{
		context: 'Global' | 'Local' | 'Argument' | 'Upvalue' | 'Import';
		lineNr: number;
		colNr: number;
		name: string;
		isConst: boolean;
		type: string;
		returnType: string;
		moduleFunctions: ModuleFunction[];
		disassemblyId?: number; // if type === function
	}>;
	disasm: Disassembly[];
}

const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);
const connection = createConnection(ProposedFeatures.all);

connection.onInitialize((_: InitializeParams) => {
	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			completionProvider: {
				resolveProvider: true,
			},
			hoverProvider: true,
		},
	};

	return result;
});

let documentLangServers: Map<string, ChildProcess> = new Map();
let documentHoverServers: Map<string, ChildProcess> = new Map();

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

			try {
				const serverJson: LangServerResult = JSON.parse(serverResult);

				for (const error of serverJson.errors) {
					if (error.generic) {
						console.error('Unhandled error: ', error);
						continue;
					}

					const diagnostic: Diagnostic = {
						severity: DiagnosticSeverity.Warning,
						range: {
							start: Position.create(error.lineNr - 1, error.colNr),
							end: Position.create(error.lineNr - 1, error.colNr + error.token.length),
						},
						message: error.desc,
						source: 'Q-Script'
					};
	
					diagnostics.push(diagnostic);
				}
			} catch (err) {
				console.error(err);
			}

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

connection.onHover((textDocumentPositionParams, token) => (new Promise((resolve, reject) => {
	const textDocument = documents.get(textDocumentPositionParams.textDocument.uri);

	if (!textDocument) {
		return;
	}

	if (documentHoverServers.has(textDocument.uri)) {
		const serverProcess = documentHoverServers.get(textDocument.uri);

		if (serverProcess) {
			serverProcess.kill('SIGINT');
		}

		documentHoverServers.delete(textDocument.uri);
	}

	const text = textDocument.getText();
	const buffer: any[] = [];

	const serverProcess = spawn('F:/Projects/qscript-language/Debug/LangSrv.exe', ['--exit', '--listSymbols']);

	if (serverProcess.pid) {
		serverProcess.stdout.on('data', (data) => {
			buffer.push(data);
		});

		serverProcess.stdout.on('end', () => {
			if (buffer.length === 0) {
				return;
			}

			const serverResult = buffer.join('');
			const { position } = textDocumentPositionParams;
			let symbol: LangServerResult['symbols'][0] | null = null;
			let serverJson: LangServerResult | null = null;

			console.log(`Received hover update of ${serverResult.length} bytes`);

			try {
				serverJson = JSON.parse(serverResult);
				for (const variable of serverJson!.symbols) {
					if (position.line !== variable.lineNr - 1) {
						continue;
					}

					if (position.character >= variable.colNr && position.character <= variable.colNr + variable.name.length) {
						symbol = variable;
						break;
					}
				}

			} catch (err) {
				reject(err);
			}

			let contents = null;

			const printArg = (f: ModuleFunction, a: ModuleFunctionArg, ai: number) =>
				(a.isVarArgs ? '...' : `${a.type} ${a.name} ${a.type === 'function' ? `/* -> ${a.returnType} */` : ''} ${(ai < f.args.length - 1) ? ',' : '' }`);

			const printFn = (f: ModuleFunction) => 
				(`const ${f.name} = (${f.args.map((a, ai) => printArg(f, a, ai))}) -> ${f.returnType} { /* <native code> */ }`);

			if (symbol && symbol.context === 'Import') {
				contents = `### ${symbol.name}
---
\`\`\`qscript
// Imported functions
${symbol.moduleFunctions.map(printFn).join('\n')}
\`\`\`
`;
			} else if (symbol) {
				const types = symbol.type === 'unknown' ? ['', 'unknown, '] : [`${symbol.type} `, ''];
				const varType = symbol.isConst ? 'const' : 'var';

				contents = `### ${symbol.name}
---
\`\`\`qscript
${varType} ${types[0]}${symbol.name}; // ${types[1]}${symbol.context} ${symbol.type === 'function' ? `(returnType=${symbol.returnType})` : ''}
\`\`\`
`;
			}

			// Include a diassembly view?
			if (symbol && symbol.disassemblyId) {
				const disassembly = serverJson!.disasm.find((disasm) => disasm.id === symbol!.disassemblyId);
				if (disassembly) {
					contents += `---
\`\`\`bash
=== ${disassembly.name} ===
${disassembly.opcodes.map((o) => (`${o.address.padStart(4, '0')} ${o.full.padEnd(25, ' ')} ${`[${o.lineNr}, ${o.colNr}, "${o.token}"`}]`)).join('\n')}
\`\`\`
					`;
				}
			}

			resolve(contents ? { contents } : null);
		});

		serverProcess.on('close', () => documentHoverServers.delete(textDocument.uri));

		documentHoverServers.set(textDocument.uri, serverProcess);

		serverProcess.stdin.write(text);
		serverProcess.stdin.end();
	}
})));

documents.listen(connection);
connection.listen();
