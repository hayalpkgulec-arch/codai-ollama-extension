import type { WebviewApi } from "vscode-webview";

class VSCodeAPIWrapper {
    private readonly vsCodeApi: WebviewApi<unknown> | undefined;

    constructor() {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        if (typeof acquireVsCodeApi === "function") {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            this.vsCodeApi = acquireVsCodeApi();
        }
    }

    public postMessage(message: unknown) {
        if (this.vsCodeApi) {
            this.vsCodeApi.postMessage(message);
        } else {
            console.log("VS Code API POST:", message);
        }
    }

    public getState() {
        if (this.vsCodeApi) {
            return this.vsCodeApi.getState();
        } else {
            const state = localStorage.getItem("vscodeState");
            return state ? JSON.parse(state) : undefined;
        }
    }

    public setState(state: unknown) {
        if (this.vsCodeApi) {
            this.vsCodeApi.setState(state);
        } else {
            localStorage.setItem("vscodeState", JSON.stringify(state));
        }
    }
}

export const vscode = new VSCodeAPIWrapper();
