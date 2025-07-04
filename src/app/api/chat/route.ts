

import { NextResponse } from "next/server";

export const runtime = "edge";

const SUPPORTED_MODELS = {
  // Flash Models
  "gemini-1.5-flash": {
    name: "Gemini 1.5 Flash",
    capabilities: ["text", "image-analysis"],
    endpoint: "generateContent",
    version: "v1beta"
  },
  "gemini-2.0-flash": {
    name: "Gemini 2.0 Flash",
    capabilities: ["text", "image-analysis", "video-analysis"],
    endpoint: "generateContent",
    version: "v1beta"
  },
  // Pro Models
  "gemini-1.5-flash-latest": {
    name: "Gemini 1.5 Pro",
    capabilities: ["text", "image-analysis", "audio-analysis"],
    endpoint: "generateContent",
    version: "v1beta"
  },
  "gemini-2.5-pro-preview-05-06": {
    name: "Gemini 2.5 Pro",
    capabilities: ["text", "image-generation", "video-analysis"],
    endpoint: "generateContent",
    version: "v1beta"
  }
};

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Server configuration error: Missing API key" },
        { status: 500 }
      );
    }

    const formData = await req.formData();
    const model = formData.get('model') as string;
    const messages = JSON.parse(formData.get('messages') as string);
    const file = formData.get('file') as File | null;
    const userMessage = messages[messages.length - 1]?.content || "";

    if (!(model in SUPPORTED_MODELS)) {
      return NextResponse.json(
        { error: "Invalid model selected" },
        { status: 400 }
      );
    }

    const modelInfo = SUPPORTED_MODELS[model as keyof typeof SUPPORTED_MODELS];
    let response;

    // Handle image generation models
    if (modelInfo.endpoint === "generateImage") {
      const prompt = userMessage || "Generate a professional business image";

      type ImagenRequestBody = {
        prompt: {
          text: string;
          image?: {
            bytesBase64Encoded: string;
          };
        };
      };

      const requestBody: ImagenRequestBody = {
        prompt: {
          text: prompt
        }
      };

      if (file) {
        const buffer = await file.arrayBuffer();
        requestBody.prompt.image = {
          bytesBase64Encoded: Buffer.from(buffer).toString('base64')
        };
      }

      response = await fetch(
        `https://generativelanguage.googleapis.com/${modelInfo.version}/models/${model}:${modelInfo.endpoint}?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody)
        }
      );
    }
    // Handle text/image analysis models
    else {
      type GeminiPayload = {
        contents: Array<{
          parts: Array<
            | { text: string }
            | { inlineData: { mimeType: string; data: string } }
            | { image: { bytesBase64Encoded: string } }
          >;
        }>;
        systemInstruction?: {
          parts: Array<{ text: string }>;
        };
      };

      const payload: GeminiPayload = {
        contents: [{
          parts: [{ text: userMessage }]
        }],
        systemInstruction: {
          parts: [{
            text: "You are an expert business advisor. Provide detailed, actionable responses."
          }]
        }
      };

      if (file) {
        const mimeType = file.type;
        const buffer = await file.arrayBuffer();
        const base64Data = Buffer.from(buffer).toString('base64');

        // Different models handle files differently
        if (modelInfo.capabilities.includes("image-analysis")) {
          payload.contents[0].parts.push({
            inlineData: {
              mimeType,
              data: base64Data
            }
          });
        } else if (modelInfo.capabilities.includes("image-generation")) {
          payload.contents[0].parts.push({
            text: "Here is the attached image for reference:",
            image: { //This line has the following error: Object literal may only specify known properties, and 'image' does not exist in type '{ text: string; } | { inlineData: { mimeType: string; data: string; }; }'.ts(2353)
              bytesBase64Encoded: base64Data
            }
          });
        }
      }

      response = await fetch(
        `https://generativelanguage.googleapis.com/${modelInfo.version}/models/${model}:${modelInfo.endpoint}?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }
      );
    }

    if (!response.ok) {
      const errorData = await response.json();
      console.error("API Error Details:", {
        status: response.status,
        statusText: response.statusText,
        model,
        error: errorData.error
      });

      throw new Error(errorData.error?.message || "API request failed");
    }

    const data = await response.json();

    // Handle different response formats
    if (modelInfo.endpoint === "generateImage") {
      const imageData = data.image?.bytesBase64Encoded || data[0]?.bytesBase64Encoded;
      if (!imageData) {
        throw new Error("No image data received from the API");
      }

      return NextResponse.json({
        messages: [{
          role: "assistant",
          content: "Here's the generated image:",
          image: imageData,
          mimeType: "image/png"
        }]
      });
    } else {
      const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text ||
        data.text ||
        "I couldn't generate a response. Please try again.";

      return NextResponse.json({
        messages: [{
          role: "assistant",
          content: responseText
        }]
      });
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("Error:", err);
    return NextResponse.json(
      { error: error.message || "Request failed" },
      { status: 500 }
    );
  }
}