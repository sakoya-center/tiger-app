import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { imageUrl, mimeType } = await req.json();
    
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("❌ MISSING API KEY!");
      return NextResponse.json({ error: "Missing API Key" }, { status: 500 });
    }

    const fileResp = await fetch(imageUrl);
    const fileBuffer = await fileResp.arrayBuffer();
    const base64File = Buffer.from(fileBuffer).toString("base64");

    const geminiMimeType = mimeType === "application/pdf" ? "application/pdf" : "image/jpeg";

    // --- הפרומפט החדש: הוספנו בסוף את הבקשה לחלץ את ה-items ---
    const prompt = `אתה רואה חשבון מומחה. חלץ מהמסמך (קבלה/חשבונית) את הנתונים הבאים בפורמט JSON בלבד:
    {
      "supplierName": "שם הספק",
      "businessId": "ח.פ או עוסק מורשה (רק מספרים)",
      "invoiceNumber": "מספר חשבונית/קבלה",
      "date": "תאריך (DD/MM/YYYY)",
      "totalAmount": "סכום כולל (רק מספר)",
      "vatAmount": "סכום מעמ (רק מספר)",
      "authorizationNumber": "מספר הקצאה (אם יש, אחרת ריק)",
      "address": "כתובת העסק",
      "category": "סווג את ההוצאה לאחת מהקטגוריות הבאות בלבד: דלק, מסעדות וכיבוד, משרד ותקשורת, תוכנה ודיגיטל, נסיעות, רכב, ציוד, כללי",
      "items": [
        { "description": "שם הפריט שנקנה", "price": "מחיר הפריט (רק מספר)" }
      ]
    }`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`;

    const geminiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: geminiMimeType, data: base64File } }
          ]
        }]
      })
    });

    const data = await geminiResponse.json();
    
    if (data.error) {
       console.error("❌ Gemini API Error:", data.error.message);
       return NextResponse.json({ error: data.error.message }, { status: 500 });
    }

    if (data.candidates && data.candidates[0].content.parts.length > 0) {
      const text = data.candidates[0].content.parts[0].text;
      const cleanJson = text.replace(/```json/g, "").replace(/```/g, "").trim();
      return NextResponse.json(JSON.parse(cleanJson));
    } else {
      return NextResponse.json({ error: "Invalid response format" }, { status: 500 });
    }

  } catch (error) {
    console.error("❌ Server Crash:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}