import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export interface PdfConversionResult {
    imageUrl: string;
    file: File | null;
    text: string;
    error?: string;
}

let pdfjsLib: any = null;
let loadPromise: Promise<any> | null = null;

async function loadPdfJs(): Promise<any> {
    if (pdfjsLib) return pdfjsLib;
    if (loadPromise) return loadPromise;

    // @ts-expect-error - pdfjs-dist/build/pdf.mjs is not a module
    loadPromise = import("pdfjs-dist/build/pdf.mjs").then((lib) => {
        lib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        pdfjsLib = lib;
        return lib;
    }).catch((error) => {
        loadPromise = null;
        throw error;
    });

    return loadPromise;
}

async function openPdf(file: Blob): Promise<any> {
    const lib = await loadPdfJs();
    return lib.getDocument({ data: await file.arrayBuffer() }).promise;
}

async function readPdfText(pdf: any): Promise<string> {
    const pages: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const text = content.items
            .map((item: { str?: string }) => item.str || '')
            .filter(Boolean)
            .join(' ');
        pages.push(text);
    }

    return pages.join('\n').trim();
}

export async function extractPdfText(file: Blob): Promise<string> {
    const pdf = await openPdf(file);
    return readPdfText(pdf);
}

export async function convertPdfToImage(
    file: File
): Promise<PdfConversionResult> {
    try {
        const pdf = await openPdf(file);
        const text = await readPdfText(pdf);
        const page = await pdf.getPage(1);

        const viewport = page.getViewport({ scale: 4 });
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        if (context) {
            context.imageSmoothingEnabled = true;
            context.imageSmoothingQuality = "high";
        }

        await page.render({ canvasContext: context!, viewport }).promise;

        return new Promise((resolve) => {
            canvas.toBlob(
                (blob) => {
                    if (blob) {
                        // Create a File from the blob with the same name as the pdf
                        const originalName = file.name.replace(/\.pdf$/i, "");
                        const imageFile = new File([blob], `${originalName}.png`, {
                            type: "image/png",
                        });

                        resolve({
                            imageUrl: URL.createObjectURL(blob),
                            file: imageFile,
                            text,
                        });
                    } else {
                        resolve({
                            imageUrl: "",
                            file: null,
                            text,
                            error: "Failed to create image blob",
                        });
                    }
                },
                "image/png",
                1.0
            ); // Set quality to maximum (1.0)
        });
    } catch (err) {
        return {
            imageUrl: "",
            file: null,
            text: "",
            error: `Failed to convert PDF: ${err}`,
        };
    }
}
