import jsPDF from 'jspdf';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import { renderElementToCanvasSafe } from './html2canvasSafe';

/**
 * Export any HTML element to a PDF file using html2canvas and jsPDF.
 */
export async function exportElementToPdf(
  element: HTMLElement,
  filename: string = 'uniace-document.pdf',
  title: string = 'UniAce Document'
): Promise<boolean> {
  const toastId = toast.loading('Generating high-resolution PDF...');
  try {
    const canvas = await renderElementToCanvasSafe(element, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff'
    });

    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();

    const imgWidth = pdfWidth - 20; // 10mm margins
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = 10; // top margin

    // First page
    pdf.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight);
    heightLeft -= (pdfHeight - 20);

    // Subsequent pages if long document
    while (heightLeft > 0) {
      position = heightLeft - imgHeight + 10;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight);
      heightLeft -= (pdfHeight - 20);
    }

    pdf.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
    toast.success('PDF downloaded successfully!', { id: toastId });
    return true;
  } catch (error) {
    console.error('Failed to export PDF:', error);
    toast.error('Could not generate PDF. Please try again.', { id: toastId });
    return false;
  }
}

/**
 * Export structured JSON data to an Excel (.xlsx) spreadsheet.
 */
export function exportJsonToExcel(
  data: Record<string, any>[],
  sheetName: string = 'UniAce Data',
  filename: string = 'uniace-export.xlsx'
): boolean {
  try {
    if (!data || data.length === 0) {
      toast.error('No data available to export');
      return false;
    }

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.substring(0, 31));

    const finalFilename = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
    XLSX.writeFile(workbook, finalFilename);
    toast.success(`Exported ${data.length} records to Excel!`);
    return true;
  } catch (error) {
    console.error('Failed to export Excel:', error);
    toast.error('Failed to export spreadsheet');
    return false;
  }
}
