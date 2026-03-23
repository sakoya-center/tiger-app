  "use client";

  import { useState, useRef, useEffect } from "react";
  import { storage, db } from "./lib/firebase";
  import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
  import { collection, addDoc, query, where, getDocs, updateDoc, doc, orderBy } from "firebase/firestore";
  import JSZip from "jszip";

  export default function Home() {
    // --- States ---
    const [activeTab, setActiveTab] = useState("home");
    const [uploading, setUploading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [imageUrl, setImageUrl] = useState("");
    const [fileType, setFileType] = useState("");
    
    // שדה חיפוש
    const [searchTerm, setSearchTerm] = useState("");
    
    const fileInputRef = useRef<HTMLInputElement>(null);
    const cameraInputRef = useRef<HTMLInputElement>(null);

    // סבב אישורים
    const [reviewQueue, setReviewQueue] = useState<any[]>([]);
    const [reviewIndex, setReviewIndex] = useState(0);

    const [stats, setStats] = useState({ totalCount: 0, pendingCount: 0, totalGross: 0, totalVat: 0 });
    const [pendingReceipts, setPendingReceipts] = useState<any[]>([]);
    const [approvedReceipts, setApprovedReceipts] = useState<any[]>([]);
    const [reportedCount, setReportedCount] = useState(0);
    const [archivedMonths, setArchivedMonths] = useState<any[]>([]);
    
    const [categoryBreakdown, setCategoryBreakdown] = useState<{name: string, amount: number, percentage: number}[]>([]);
    const [allReceipts, setAllReceipts] = useState<any[]>([]);
    const [alerts, setAlerts] = useState<{type: string, title: string, text: string}[]>([]);
    const [reviewAlerts, setReviewAlerts] = useState<{type: string, text: string}[]>([]);

    const [message, setMessage] = useState({ text: "", type: "" });
    const [formData, setFormData] = useState({
      id: "", supplierName: "", businessId: "", invoiceNumber: "", date: "",
      totalAmount: "", vatAmount: "", address: "", authorizationNumber: "", category: "", items: [] as any[]
    });

    // --- Effects ---
    useEffect(() => {
      if (activeTab === "history" || activeTab === "overview" || activeTab === "home") fetchData();
    }, [activeTab]);

    useEffect(() => {
      if (activeTab !== "review_single" && activeTab !== "review_bulk") return;
      if (allReceipts.length === 0) return;

      const currentWarnings: {type: string, text: string}[] = [];

      const isDuplicate = allReceipts.some(r => {
        if (r.id === formData.id) return false; 
        const exactMatch = r.businessId && r.invoiceNumber && r.businessId === formData.businessId && r.invoiceNumber === formData.invoiceNumber;
        const safetyNetMatch = r.supplierName && r.totalAmount && r.date && r.supplierName === formData.supplierName && parseFloat(r.totalAmount) === parseFloat(formData.totalAmount || "0") && r.date === formData.date;
        return exactMatch || safetyNetMatch;
      });

      if (isDuplicate) {
        currentWarnings.push({ type: "duplicate", text: "שים לב! נראה שחשבונית זו (או זהה לה) כבר קיימת במערכת." });
      }

      if (formData.supplierName && parseFloat(formData.totalAmount || "0") > 0) {
        const supplierHistory = allReceipts.filter((r: any) => r.supplierName === formData.supplierName && r.id !== formData.id);
        if (supplierHistory.length > 0) {
          const avgAmount = supplierHistory.reduce((sum: number, r: any) => sum + parseFloat(r.totalAmount || "0"), 0) / supplierHistory.length;
          const currentAmount = parseFloat(formData.totalAmount || "0");
          if (currentAmount > avgAmount * 1.4 && avgAmount > 0) {
            currentWarnings.push({ type: "anomaly", text: `סכום חריג: ההוצאה הממוצעת ל-"${formData.supplierName}" היא ₪${avgAmount.toFixed(0)}.` });
          }
        }
      }

      setReviewAlerts(currentWarnings);
    }, [formData, activeTab, allReceipts]);

    // --- Fetch Data ---
    const fetchData = async () => {
      const allDocsSnap = await getDocs(collection(db, "receipts"));
      const fetchedReceipts = allDocsSnap.docs.map(d => ({ ...d.data(), id: d.id }));
      setAllReceipts(fetchedReceipts);

      const now = new Date();
      const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      
      let total = 0, pending = 0, gross = 0, vat = 0, reported = 0;
      const tempPending: any[] = [];
      const tempApproved: any[] = [];
      const catTotals: Record<string, number> = {};

      fetchedReceipts.forEach((data: any) => {
        if (data.createdAt >= firstDayOfMonth) {
          total++;
          if (data.status === "Approved") { pending++; tempPending.push(data); }
          if (data.status === "Reported" || data.status === "Archived") { reported++; tempApproved.push(data); }
          const amount = parseFloat(data.totalAmount) || 0;
          gross += amount;
          vat += parseFloat(data.vatAmount) || 0;
          const cat = data.category || "כללי";
          catTotals[cat] = (catTotals[cat] || 0) + amount;
        } else {
          if (data.status === "Approved") { pending++; tempPending.push(data); }
        }
      });

      setStats({ totalCount: total, pendingCount: pending, totalGross: gross, totalVat: vat });
      setReportedCount(reported);
      setPendingReceipts(tempPending);
      setApprovedReceipts(tempApproved);

      if (gross > 0) {
        const breakdown = Object.keys(catTotals).map(cat => ({
          name: cat, amount: catTotals[cat], percentage: (catTotals[cat] / gross) * 100
        })).sort((a, b) => b.amount - a.amount);
        setCategoryBreakdown(breakdown);
      } else {
        setCategoryBreakdown([]);
      }

      const newAlerts: any[] = [];
      tempPending.forEach((pendingItem: any) => {
        const isDuplicate = fetchedReceipts.some((r: any) => 
          r.id !== pendingItem.id && 
          ((r.businessId && r.invoiceNumber && r.businessId === pendingItem.businessId && r.invoiceNumber === pendingItem.invoiceNumber) ||
          (r.supplierName && r.totalAmount && r.date && r.supplierName === pendingItem.supplierName && parseFloat(r.totalAmount) === parseFloat(pendingItem.totalAmount || "0") && r.date === pendingItem.date))
        );

        if (isDuplicate) newAlerts.push({ type: "duplicate", title: "חשד לכפילות", text: `חשבונית כפולה עבור "${pendingItem.supplierName}".` });

        const supplierHistory = fetchedReceipts.filter((r: any) => r.supplierName === pendingItem.supplierName && r.id !== pendingItem.id);
        if (supplierHistory.length > 0) {
          const avgAmount = supplierHistory.reduce((sum: number, r: any) => sum + parseFloat(r.totalAmount || "0"), 0) / supplierHistory.length;
          const currentAmount = parseFloat(pendingItem.totalAmount || "0");
          if (currentAmount > avgAmount * 1.4 && avgAmount > 0) {
            newAlerts.push({ type: "anomaly", title: "זיהוי חריגה!", text: `ההוצאה ל-"${pendingItem.supplierName}" (₪${currentAmount}) גבוהה מהממוצע.` });
          }
        }
      });

      const uniqueAlerts = newAlerts.filter((v, i, a) => a.findIndex(t => (t.text === v.text)) === i);
      setAlerts(uniqueAlerts);

      const groups: any = {};
      fetchedReceipts.filter((r:any) => r.status === "Archived").forEach((data: any) => {
        const date = new Date(data.createdAt);
        const monthYear = `${date.getMonth() + 1}/${date.getFullYear()}`;
        if (!groups[monthYear]) groups[monthYear] = [];
        groups[monthYear].push(data);
      });
      setArchivedMonths(Object.keys(groups).map(key => ({ label: key, receipts: groups[key] })));
    };

    // --- Upload & AI ---
    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        setUploading(true);
        setMessage({ text: "", type: "" });
        setFileType(file.type);
        
        const storageRef = ref(storage, `receipts/${Date.now()}_${file.name}`);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);
        setImageUrl(url);

        const response = await fetch("/api/process-receipt", {
          method: "POST",
          body: JSON.stringify({ imageUrl: url, mimeType: file.type }),
          headers: { "Content-Type": "application/json" },
        });
        const aiData = await response.json();
        
        setFormData({
          id: "", 
          supplierName: aiData.supplierName || "",
          businessId: aiData.businessId || "",
          invoiceNumber: aiData.invoiceNumber || "",
          date: aiData.date || "",
          totalAmount: aiData.totalAmount || "",
          vatAmount: aiData.vatAmount || "",
          address: aiData.address || "",
          authorizationNumber: aiData.authorizationNumber || "",
          category: aiData.category || "כללי",
          items: aiData.items || [] 
        });
        setActiveTab("review_single");
      } catch (error) { setMessage({ text: "שגיאה בעיבוד.", type: "error" }); }
      finally { setUploading(false); }
    };

    const handleSaveSingle = async () => {
      setIsSaving(true);
      try {
        const { id, ...dataToSave } = formData;
        await addDoc(collection(db, "receipts"), {
          ...dataToSave, imageUrl, fileType, status: "Approved", createdAt: new Date().toISOString(),
        });
        setMessage({ text: "נשמר בהצלחה! 🐅", type: "success" });
        setTimeout(() => { setActiveTab("home"); setMessage({ text: "", type: "" }); }, 1500);
      } catch (e) { setMessage({ text: "שגיאה בשמירה.", type: "error" }); }
      finally { setIsSaving(false); }
    };

    const processBulkReceipt = async (action: "Reported" | "Removed") => {
      setIsSaving(true);
      try {
        await updateDoc(doc(db, "receipts", formData.id), { ...formData, status: action });
        if (reviewIndex + 1 < reviewQueue.length) {
          setReviewIndex(reviewIndex + 1);
          loadReceiptIntoForm(reviewQueue[reviewIndex + 1]);
        } else {
          setActiveTab("overview");
          setMessage({ text: 'הקבלות אושרו סופית! 🐅', type: "success" });
          fetchData();
        }
      } catch (e) { console.error(e); } finally { setIsSaving(false); }
    };

    const loadReceiptIntoForm = (receipt: any) => {
      setImageUrl(receipt.imageUrl);
      setFileType(receipt.fileType || "image/jpeg");
      setFormData({ ...receipt, items: receipt.items || [] });
    };

    const startReview = async () => {
      const q = query(collection(db, "receipts"), where("status", "==", "Approved"));
      const snap = await getDocs(q);
      const list: any[] = [];
      snap.forEach(d => list.push({ ...d.data(), id: d.id }));
      if (list.length > 0) {
        setReviewQueue(list);
        setReviewIndex(0);
        loadReceiptIntoForm(list[0]);
        setActiveTab("review_bulk");
      }
    };

    const exportZip = async (receiptsList: any[], label: string, isNewReport: boolean) => {
    setIsExporting(true);
    setMessage({ text: "אורז קבלות ומכין טבלת פריסה, נא להמתין... 📦", type: "success" });
    try {
      const zip = new JSZip();
      const folderName = `Tiger_Report_${label.replace("/", "_")}`;
      const folder = zip.folder(folderName);
      if (!folder) return;

      const baseCategories = ["דלק", "נסיעות", "מסעדות וכיבוד", "משרד ותקשורת", "תוכנה ודיגיטל", "רכב", "ציוד משרדי", "חשמל", "כללי"];
      const existingCategories = receiptsList.map(r => r.category || "כללי");
      const allCategories = Array.from(new Set([...baseCategories, ...existingCategories]));

      let csvContent = "\uFEFFשם ספק,תאריך,ח.פ / עוסק,מספר קבלה,מספר הקצאה,סכום כולל מע\"מ,סכום ללא מע\"מ,סכום מע\"מ,";
      csvContent += allCategories.join(",") + "\n";

      // משתנים לשמירת הסכומים של שורת הסך-הכל
      let sumTotal = 0;
      let sumNoVat = 0;
      let sumVat = 0;
      let catSums: Record<string, number> = {};

      for (let i = 0; i < receiptsList.length; i++) {
        const r = receiptsList[i];
        
        const total = parseFloat(r.totalAmount) || 0;
        const vat = parseFloat(r.vatAmount) || 0;
        const noVat = total - vat;

        // הוספה לסכום הכולל
        sumTotal += total;
        sumVat += vat;
        sumNoVat += noVat;

        const itemCategory = (r.category || "כללי").trim();
        catSums[itemCategory] = (catSums[itemCategory] || 0) + total; // הוספה לסכום הקטגוריה

        let row = `"${r.supplierName || ""}","${r.date || ""}","${r.businessId || ""}","${r.invoiceNumber || ""}","${r.authorizationNumber || ""}","${total.toFixed(2)}","${noVat.toFixed(2)}","${vat.toFixed(2)}"`;

        for (const cat of allCategories) {
          if (cat === itemCategory) {
            row += `,"${total.toFixed(2)}"`;
          } else {
            row += `,""`;
          }
        }

        csvContent += row + "\n";

        if (r.imageUrl) {
          try {
            const response = await fetch(r.imageUrl);
            const blob = await response.blob();
            const ext = r.fileType === "application/pdf" ? "pdf" : "jpg";
            folder.file(`Receipt_${i + 1}_${(r.supplierName || "unknown").replace(/[^a-zA-Zא-ת0-9]/g, '')}.${ext}`, blob);
          } catch (err) { console.error("Failed fetching image", err); }
        }
      }

      // --- הוספת שורת סך הכל ---
      let totalRow = `"סה""כ","","","","","${sumTotal.toFixed(2)}","${sumNoVat.toFixed(2)}","${sumVat.toFixed(2)}"`;
      for (const cat of allCategories) {
        totalRow += `,"${(catSums[cat] || 0).toFixed(2)}"`;
      }
      csvContent += totalRow + "\n";

      folder.file("Report.csv", csvContent);
      
      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${folderName}.zip`;
      a.click();

      if (isNewReport) {
         for (const r of receiptsList) {
           await updateDoc(doc(db, "receipts", r.id), { status: "Archived" });
         }
         fetchData(); 
      }

      setMessage({ text: "הדו״ח ירד בהצלחה! 🔥", type: "success" });
      setTimeout(() => setMessage({ text: "", type: "" }), 3000);
    } catch (error) {
      setMessage({ text: "שגיאה ביצירת הדו״ח.", type: "error" });
    } finally {
      setIsExporting(false);
    }
  };

        csvContent += row + "\n";

        // שמירת קובץ התמונה ל-ZIP
        if (r.imageUrl) {
          try {
            const response = await fetch(r.imageUrl);
            const blob = await response.blob();
            const ext = r.fileType === "application/pdf" ? "pdf" : "jpg";
            folder.file(`Receipt_${i + 1}_${(r.supplierName || "unknown").replace(/[^a-zA-Zא-ת0-9]/g, '')}.${ext}`, blob);
          } catch (err) { console.error("Failed fetching image", err); }
        }
      }

      // הוספת טבלת האקסל לתוך התיקייה
      folder.file("Report.csv", csvContent);
      
      // אריזה והורדה למחשב
      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${folderName}.zip`;
      a.click();

      // אם זה סגירת חודש, מעבירים לארכיון
      if (isNewReport) {
         for (const r of receiptsList) {
           await updateDoc(doc(db, "receipts", r.id), { status: "Archived" });
         }
         fetchData(); 
      }

      setMessage({ text: "הדו״ח ירד בהצלחה! 🔥", type: "success" });
      setTimeout(() => setMessage({ text: "", type: "" }), 3000);
    } catch (error) {
      setMessage({ text: "שגיאה ביצירת הדו״ח.", type: "error" });
    } finally {
      setIsExporting(false);
    }
  };

    const filterList = (list: any[]) => {
      if (!searchTerm) return list;
      const term = searchTerm.toLowerCase();
      return list.filter(r => 
        (r.supplierName || "").toLowerCase().includes(term) ||
        (r.category || "").toLowerCase().includes(term) ||
        (r.totalAmount || "").toString().includes(term) ||
        (r.invoiceNumber || "").includes(term)
      );
    };

    return (
      <div className="h-screen bg-gray-50 flex flex-col font-sans text-gray-900 overflow-hidden" dir="rtl">
        
        {/* הדר טייגר: שחור וכתום */}
        <header className="shrink-0 p-6 bg-black text-center shadow-md border-b-4 border-orange-500 z-10 flex justify-between items-center">
          <div className="w-8"></div> 
          <h1 className="text-3xl font-black text-orange-500 tracking-widest">TIGER 🐯</h1>
          <div onClick={() => setActiveTab("overview")} className="cursor-pointer text-xl opacity-80 text-orange-400 hover:text-orange-500 transition-colors" title="חיפוש">🔍</div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-6 flex flex-col items-center w-full">
          {message.text && (
            <div className={`mb-4 p-4 rounded-xl font-bold w-full max-w-md text-center shadow-md shrink-0 ${message.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
              {message.text}
            </div>
          )}

          {/* --- מסך בית --- */}
          {activeTab === "home" && (
            <div className="flex flex-col md:flex-row items-start justify-center gap-6 mt-4 w-full max-w-5xl pb-6">
              <div className="flex flex-col items-center w-full md:w-3/5 bg-white p-8 md:p-10 rounded-[2.5rem] shadow-lg border border-gray-200 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-orange-100 rounded-full blur-3xl -z-10 opacity-50"></div>
                
                <div className="bg-orange-100 p-8 md:p-10 rounded-full mb-6 shadow-inner text-6xl md:text-7xl border-2 border-orange-500 z-10 text-center">
                  {uploading ? "🐅" : "🥩"}
                </div>
                
                <h2 className="text-xl md:text-2xl font-black mb-8 text-black text-center z-10">
                  {uploading ? "הנמר מפענח נתונים..." : "העלה קבלה או חשבונית PDF"}
                </h2>
                
                <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/*,application/pdf" />
                <input type="file" ref={cameraInputRef} onChange={handleFileChange} className="hidden" accept="image/*" capture="environment" />
                
                <div className="flex flex-col gap-4 w-full max-w-xs z-10">
                  <button onClick={() => cameraInputRef.current?.click()} disabled={uploading} className="bg-orange-500 text-white py-4 rounded-2xl font-black text-lg shadow-[0_5px_0_0_#cc4a00] active:translate-y-1 transition-all flex justify-center items-center gap-2 hover:bg-orange-600">
                    <span className="text-2xl">📸</span> צלם קבלה
                  </button>
                  <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="bg-white border-2 border-orange-500 text-orange-600 py-3 rounded-2xl font-bold text-lg shadow-[0_5px_0_0_#cc4a00] active:translate-y-1 transition-all flex justify-center items-center gap-2 hover:bg-orange-50">
                    <span className="text-2xl">📄</span> בחר קובץ
                  </button>
                </div>
              </div>

              <div className="w-full md:w-2/5 flex flex-col gap-4">
                <div className="bg-white/80 backdrop-blur-sm p-5 rounded-3xl shadow-sm border border-gray-200">
                  <h4 className="font-bold text-orange-600 mb-4 text-right flex items-center gap-2 text-sm border-b border-gray-100 pb-3">
                    <span className="text-lg">🚨</span> התראות המערכת
                  </h4>
                  <div className="space-y-3">
                    {alerts.length > 0 ? alerts.map((alert, idx) => (
                      <div key={idx} className={`bg-white p-3 rounded-xl text-xs border-r-4 shadow-sm text-right ${alert.type === 'anomaly' ? 'border-red-500' : 'border-orange-500'}`}>
                        <span className={`font-bold block mb-1 ${alert.type === 'anomaly' ? 'text-red-700' : 'text-orange-600'}`}>{alert.title}</span>
                        <span className="text-gray-800">{alert.text}</span>
                      </div>
                    )) : (
                      <div className="bg-green-50 p-4 rounded-xl text-sm border-r-4 border-green-500 shadow-sm text-right text-green-700">
                        <span className="font-bold block mb-1">הכל תקין! ✅</span>
                        הנמר שומר עליך, לא זוהו כפילויות.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* --- מסך סקירה (Review) --- */}
          {(activeTab === "review_single" || activeTab === "review_bulk") && (
            <div className="bg-white p-6 rounded-3xl shadow-xl border-2 border-orange-500 w-full max-w-4xl flex flex-col md:flex-row gap-8 mb-6 relative">
              <div className="flex-1 min-h-[300px] md:h-[500px] bg-gray-50 rounded-2xl overflow-hidden flex items-center justify-center border-2 border-dashed border-orange-300 relative">
                {fileType === "application/pdf" ? (
                  <div className="text-center p-6">
                    <span className="text-6xl block mb-4">📄</span>
                    <p className="font-bold text-gray-500">קובץ PDF נטען בהצלחה</p>
                  </div>
                ) : (
                  <img src={imageUrl} className="max-w-full max-h-full object-contain" />
                )}
                <div className="absolute top-3 left-3 bg-orange-500 text-white px-3 py-1 rounded-full text-xs font-bold shadow-md">
                  {formData.category}
                </div>
              </div>
              
              <div className="flex-1 flex flex-col text-right">
                <h3 className="font-black text-2xl border-b-2 border-orange-500 pb-2 mb-4 text-black">וידוא נתונים</h3>
                
                <div className="flex-1 overflow-y-auto pr-1 space-y-4">
                  {reviewAlerts.length > 0 && (
                    <div className="space-y-2">
                      {reviewAlerts.map((alert, idx) => (
                        <div key={idx} className={`p-3 rounded-lg text-sm font-bold shadow-sm border-r-4 animate-pulse ${alert.type === 'duplicate' ? 'bg-orange-50 text-orange-700 border-orange-500' : 'bg-red-50 text-red-700 border-red-500'}`}>
                          {alert.type === 'duplicate' ? '⚠️ ' : '🚨 '} {alert.text}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                      <label className="block text-xs font-bold text-gray-500 mb-1">שם ספק</label>
                      <input type="text" value={formData.supplierName} onChange={(e) => setFormData({...formData, supplierName: e.target.value})} className="w-full p-3 bg-white border border-gray-200 rounded-xl focus:border-orange-500 transition-all font-bold text-black" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1">סכום כולל (₪)</label>
                      <input type="number" value={formData.totalAmount} onChange={(e) => setFormData({...formData, totalAmount: e.target.value})} className="w-full p-3 bg-orange-50 border border-orange-200 rounded-xl font-black text-orange-600 transition-all text-lg" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1">תאריך</label>
                      <input type="text" value={formData.date} onChange={(e) => setFormData({...formData, date: e.target.value})} className="w-full p-3 bg-white border border-gray-200 rounded-xl transition-all text-left dir-ltr text-black" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1">ח.פ / עוסק</label>
                      <input type="text" value={formData.businessId} onChange={(e) => setFormData({...formData, businessId: e.target.value})} className="w-full p-3 bg-white border border-gray-200 rounded-xl text-black" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1">מס' קבלה</label>
                      <input type="text" value={formData.invoiceNumber} onChange={(e) => setFormData({...formData, invoiceNumber: e.target.value})} className="w-full p-3 bg-white border border-gray-200 rounded-xl text-black" />
                    </div>
                  </div>

                  {/* פירוט שורות - ה-AI חילץ! */}
                  {formData.items && formData.items.length > 0 && (
                    <div className="mt-4 border-t border-gray-200 pt-4">
                      <label className="block text-xs font-bold text-gray-500 mb-2">🛒 פירוט פריטים מקבלה זו:</label>
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 max-h-32 overflow-y-auto">
                        {formData.items.map((item, i) => (
                          <div key={i} className="flex justify-between items-center text-sm py-1.5 border-b border-gray-200 last:border-0">
                            <span className="text-black truncate pr-2" title={item.description}>{item.description}</span>
                            <span className="font-bold text-orange-600 pl-2 whitespace-nowrap">₪{item.price}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex gap-3 mt-6 pt-4 border-t border-gray-200">
                  {activeTab === "review_single" ? (
                    <button onClick={handleSaveSingle} className="flex-1 bg-orange-600 text-white py-4 rounded-xl font-bold shadow-[0_4px_0_0_#993300] active:translate-y-1 hover:bg-orange-700 transition">שמור למאגר</button>
                  ) : (
                    <button onClick={() => processBulkReceipt("Reported")} className="flex-1 bg-orange-600 text-white py-4 rounded-xl font-bold shadow-[0_4px_0_0_#993300] active:translate-y-1 hover:bg-orange-700 transition">אשר והמשך</button>
                  )}
                  <button onClick={() => setActiveTab(activeTab === "review_single" ? "home" : "overview")} className="p-4 bg-gray-200 text-gray-800 rounded-xl font-bold hover:bg-gray-300 transition">ביטול</button>
                </div>
              </div>
            </div>
          )}

          {/* --- מסך מבט על (Overview) --- */}
          {activeTab === "overview" && (
            <div className="w-full max-w-md space-y-6 pb-6">
              
              {/* שורת חיפוש אגרסיבית */}
              <div className="relative shadow-sm rounded-2xl">
                <input 
                  type="text" 
                  placeholder="חפש ספק, סכום או קטגוריה..." 
                  className="w-full p-4 pr-12 rounded-2xl border-2 border-gray-200 bg-white focus:border-orange-500 outline-none text-black transition-all"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <span className="absolute right-4 top-4 text-xl opacity-40 text-black">🔍</span>
              </div>

              {!searchTerm && (
                <>
                  <div className="bg-white p-6 rounded-3xl shadow-lg border-2 border-black text-right">
                    <h3 className="font-black text-xl mb-4 text-black flex items-center gap-2">👁️ תמונת מצב חודשית</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200">
                        <span className="text-xs text-gray-500 block mb-1">הוצאות החודש</span>
                        <span className="text-2xl font-black text-black">₪{stats.totalGross.toLocaleString()}</span>
                      </div>
                      <div className="bg-orange-50 p-4 rounded-2xl border border-orange-200">
                        <span className="text-xs text-orange-600 block mb-1">מע"מ מוכר</span>
                        <span className="text-2xl font-black text-orange-600">₪{stats.totalVat.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>

                  {categoryBreakdown.length > 0 && (
                    <div className="bg-white p-5 rounded-2xl shadow-md border border-gray-200">
                      <h4 className="font-bold text-black mb-4 text-right flex items-center gap-2 border-b border-gray-100 pb-2">
                        <span>📊 התפלגות הוצאות</span>
                      </h4>
                      <div className="space-y-4">
                        {categoryBreakdown.map((cat, idx) => (
                          <div key={idx} className="w-full">
                            <div className="flex justify-between text-sm mb-1">
                              <span className="font-bold text-black">{cat.name}</span>
                              <span className="text-orange-600 font-bold">₪{cat.amount.toLocaleString()}</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-2.5">
                              <div className="bg-orange-500 h-2.5 rounded-full" style={{ width: `${cat.percentage}%` }}></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              <div className="bg-white p-5 rounded-2xl shadow-md border border-gray-200">
                <h4 className="font-bold text-black mb-3 text-right flex justify-between items-center border-b border-gray-100 pb-2">
                  <span>ממתינות לאישור ({filterList(pendingReceipts).length})</span>
                  {filterList(pendingReceipts).length > 0 && !searchTerm && <span className="bg-orange-100 text-orange-600 px-2 py-1 rounded-full text-xs border border-orange-200">דורש טיפול</span>}
                </h4>
                <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                  {filterList(pendingReceipts).length > 0 ? filterList(pendingReceipts).map(r => (
                    <div key={r.id} className="flex justify-between items-center bg-gray-50 hover:bg-gray-100 p-3 rounded-xl text-sm transition-colors cursor-pointer border border-gray-200" onClick={() => { loadReceiptIntoForm(r); setActiveTab("review_single"); }}>
                      <span className="font-black text-black">₪{parseFloat(r.totalAmount || "0").toLocaleString()}</span>
                      <div className="text-right">
                        <span className="text-gray-800 block font-bold">{r.supplierName || "ספק לא ידוע"}</span>
                        <span className="text-[10px] text-orange-600">{r.category}</span>
                      </div>
                    </div>
                  )) : <p className="text-center text-gray-400 text-sm py-4">{searchTerm ? "לא נמצאו תוצאות" : "אין קבלות ממתינות 🎉"}</p>}
                </div>
              </div>

              <div className="bg-white p-5 rounded-2xl shadow-md border border-gray-200">
                <h4 className="font-bold text-green-600 mb-3 text-right border-b border-gray-100 pb-2">אושרו ונכנסו לדו"ח ({filterList(approvedReceipts).length})</h4>
                <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                  {filterList(approvedReceipts).length > 0 ? filterList(approvedReceipts).map(r => (
                    <div key={r.id} className="flex justify-between items-center bg-green-50 p-2 rounded-lg text-sm border border-green-100">
                      <span className="font-bold text-green-700">₪{parseFloat(r.totalAmount || "0").toLocaleString()}</span>
                      <div className="text-right">
                        <span className="text-gray-800 block font-bold">{r.supplierName || "ספק לא ידוע"}</span>
                        <span className="text-[10px] text-green-700 opacity-70">{r.category}</span>
                      </div>
                    </div>
                  )) : <p className="text-center text-gray-400 text-sm py-2">לא נמצאו תוצאות</p>}
                </div>
              </div>
            </div>
          )}

          {/* --- מסך דוחות --- */}
          {activeTab === "history" && (
            <div className="w-full max-w-md space-y-6 pb-6">
              <div className="bg-black p-6 rounded-3xl shadow-xl text-white">
                <h3 className="font-black text-2xl mb-2 text-right text-orange-500">הפקת דו"ח לרואה חשבון</h3>
                <p className="text-gray-400 text-sm text-right mb-6">מערכת ה-AI תארוז את כל הקבלות לקובץ מסודר עם טבלת אקסל.</p>
                
                {stats.pendingCount > 0 ? (
                  <button onClick={startReview} className="w-full bg-red-600 text-white py-4 rounded-xl font-bold mb-3 shadow-md hover:bg-red-700 transition">
                    יש לאשר {stats.pendingCount} קבלות לפני סגירה
                  </button>
                ) : reportedCount > 0 ? (
                  <button onClick={() => exportZip(approvedReceipts, new Date().toLocaleDateString("he-IL", {month: 'numeric', year:'numeric'}), true)} disabled={isExporting} className="w-full bg-orange-500 text-white py-4 rounded-xl font-black shadow-lg hover:bg-orange-600 transition text-lg disabled:opacity-50">
                    {isExporting ? "אורז קבצים... 📦" : "הורד קובץ ZIP וסגור חודש"}
                  </button>
                ) : <p className="text-center text-gray-500 bg-gray-900 p-4 rounded-xl">אין נתונים חדשים להורדה</p>}
              </div>

              <div className="bg-white p-6 rounded-3xl border border-gray-200">
                <h3 className="font-bold text-lg mb-4 text-right text-black">📁 ארכיון דוחות סגורים</h3>
                {archivedMonths.length > 0 ? archivedMonths.map(m => (
                  <div key={m.label} className="flex justify-between items-center bg-gray-50 p-4 rounded-xl mb-3 shadow-sm border-r-4 border-orange-500">
                    <button onClick={() => exportZip(m.receipts, m.label, false)} disabled={isExporting} className="text-orange-600 font-bold text-sm bg-white border border-gray-200 px-4 py-2 rounded-lg hover:bg-gray-100 transition disabled:opacity-50">הורד ZIP</button>
                    <span className="font-bold text-black">{m.label}</span>
                  </div>
                )) : <p className="text-center text-gray-500 text-sm">אין עדיין דוחות בארכיון</p>}
              </div>
            </div>
          )}
        </main>

        <nav className="shrink-0 bg-black border-t-4 border-orange-500 p-2 pb-6 w-full flex justify-around shadow-[0_-10px_20px_rgba(0,0,0,0.2)] z-10">
          <div onClick={() => { setSearchTerm(""); setActiveTab("home"); }} className={`flex flex-col items-center justify-center p-2 rounded-2xl w-20 transition-all cursor-pointer ${activeTab === "home" ? "text-orange-500 -translate-y-1" : "text-gray-500 hover:text-gray-400"}`}>
            <span className="text-2xl mb-1">🏠</span><span className="text-[10px] font-bold">בית</span>
          </div>
          <div onClick={() => setActiveTab("overview")} className={`flex flex-col items-center justify-center p-2 rounded-2xl w-20 transition-all cursor-pointer ${activeTab === "overview" ? "text-orange-500 -translate-y-1" : "text-gray-500 hover:text-gray-400"}`}>
            <span className="text-2xl mb-1">👁️</span><span className="text-[10px] font-bold">מבט על</span>
          </div>
          <div onClick={() => { setSearchTerm(""); setActiveTab("history"); }} className={`flex flex-col items-center justify-center p-2 rounded-2xl w-20 transition-all cursor-pointer ${activeTab === "history" ? "text-orange-500 -translate-y-1" : "text-gray-500 hover:text-gray-400"}`}>
            <span className="text-2xl mb-1">📁</span><span className="text-[10px] font-bold">דוחות</span>
          </div>
        </nav>
        
      </div>
    );
  }