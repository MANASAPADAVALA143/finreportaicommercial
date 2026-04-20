Attribute VB_Name = "FinReportAI_Analyze"
'------------------------------------------------------------------------------
' FinReportAI — Excel → POST /excel/analyze (multipart/form-data)
' Pure VBA: MSXML2 + ADODB.Stream. No curl / PowerShell required.
'
' Setup:
'   1. In Excel: Alt+F11 → File → Import File → select this .bas (or paste into a module).
'   2. Edit FINREPORT_API_BASE below to your Railway URL (no trailing slash).
'   3. Insert a button → Assign macro → AnalyzeWithAI
'   4. Save workbook as .xlsm (macro-enabled).
'------------------------------------------------------------------------------
Option Explicit

' *** Set your deployed API root (https only in production) ***
Public Const FINREPORT_API_BASE As String = "https://your-app.up.railway.app"
' Local testing: "http://127.0.0.1:8000"

' Optional: send X-API-Key if you set CLIENT_API_KEY on the server for /mcp only — not used for /excel.
Public Const FINREPORT_EXCEL_API_KEY As String = ""

'------------------------------------------------------------------------------
' Entry point — assign this macro to your shape/button.
'------------------------------------------------------------------------------
Public Sub AnalyzeWithAI()
    Dim analysisType As String
    analysisType = InputBox( _
        "Enter analysis_type:" & vbCrLf & vbCrLf & _
        "variance" & vbCrLf & "pl_commentary" & vbCrLf & "anomaly", _
        "FinReportAI", "variance")
    If Len(Trim$(analysisType)) = 0 Then Exit Sub

    analysisType = Trim$(analysisType)
    If analysisType <> "variance" And analysisType <> "pl_commentary" And analysisType <> "anomaly" Then
        MsgBox "Invalid type. Use: variance, pl_commentary, or anomaly.", vbExclamation, "FinReportAI"
        Exit Sub
    End If

    Dim tempUpload As String
    tempUpload = Environ("TEMP") & "\finreport_upload_" & Format(Now, "yyyymmddhhnnss") & ".xlsx"

    On Error GoTo ErrSave
    ActiveWorkbook.SaveCopyAs tempUpload
    On Error GoTo ErrHandler

    Application.StatusBar = "FinReportAI: uploading…"

    Dim outPath As String
    outPath = Environ("TEMP") & "\FinReportAI_ai_result.xlsx"

    Dim httpStatus As Long
    Dim errDetail As String
    If Not PostExcelAnalyze(FINREPORT_API_BASE, analysisType, tempUpload, outPath, httpStatus, errDetail) Then
        Application.StatusBar = False
        MsgBox "Request failed (" & httpStatus & ")." & vbCrLf & vbCrLf & errDetail, vbCritical, "FinReportAI"
        GoTo Cleanup
    End If

    Application.StatusBar = False

    If Dir(outPath) <> "" Then
        Workbooks.Open outPath
        MsgBox "AI analysis saved. Check the 'AI Commentary' sheet.", vbInformation, "FinReportAI"
    Else
        MsgBox "No file returned.", vbCritical, "FinReportAI"
    End If

Cleanup:
    On Error Resume Next
    Kill tempUpload
    On Error GoTo 0
    Exit Sub

ErrSave:
    Application.StatusBar = False
    MsgBox "Could not save a copy for upload: " & Err.Description & vbCrLf & vbCrLf & _
           "Save the workbook once, then try again.", vbCritical, "FinReportAI"
    Exit Sub

ErrHandler:
    Application.StatusBar = False
    MsgBox "Error: " & Err.Description, vbCritical, "FinReportAI"
    Resume Cleanup
End Sub

'------------------------------------------------------------------------------
' POST multipart/form-data; returns True if outPath written (HTTP 200 + xlsx).
'------------------------------------------------------------------------------
Private Function PostExcelAnalyze( _
    ByVal apiBase As String, _
    ByVal analysisType As String, _
    ByVal filePath As String, _
    ByVal saveResponseTo As String, _
    ByRef httpStatus As Long, _
    ByRef errDetail As String) As Boolean

    PostExcelAnalyze = False
    errDetail = ""

    Dim url As String
    url = RemoveTrailingSlash(apiBase) & "/excel/analyze?analysis_type=" & analysisType

    Dim boundary As String
    boundary = "----FinReportAI_" & Replace(CreateObject("Scripting.FileSystemObject").GetTempName, ".", "")

    Dim body() As Byte
    body = BuildMultipartBody(boundary, filePath)

    Dim xhr As Object
    Set xhr = CreateObject("MSXML2.XMLHTTP.6.0")

    xhr.Open "POST", url, False
    xhr.setRequestHeader "Content-Type", "multipart/form-data; boundary=" & boundary
    If Len(FINREPORT_EXCEL_API_KEY) > 0 Then
        xhr.setRequestHeader "X-API-Key", FINREPORT_EXCEL_API_KEY
    End If
    xhr.send body

    httpStatus = xhr.Status

    If httpStatus <> 200 Then
        errDetail = xhr.responseText
        If Len(errDetail) > 500 Then errDetail = Left$(errDetail, 500) & "…"
        Exit Function
    End If

    Dim ct As String
    ct = LCase$(xhr.getResponseHeader("Content-Type"))
    If InStr(ct, "spreadsheetml") = 0 And InStr(ct, "octet-stream") = 0 Then
        errDetail = "Unexpected Content-Type: " & ct
        Exit Function
    End If

    SaveBinaryToFile xhr.responseBody, saveResponseTo
    PostExcelAnalyze = True
End Function

'------------------------------------------------------------------------------
Private Function BuildMultipartBody(ByVal boundary As String, ByVal filePath As String) As Byte()
    Dim header As String
    header = "--" & boundary & vbCrLf & _
             "Content-Disposition: form-data; name=""file""; filename=""upload.xlsx""" & vbCrLf & _
             "Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" & vbCrLf & vbCrLf

    Dim footer As String
    footer = vbCrLf & "--" & boundary & "--" & vbCrLf

    Dim bHead() As Byte
    bHead = Utf8Bytes(header)
    Dim bFoot() As Byte
    bFoot = Utf8Bytes(footer)

    Dim bFile() As Byte
    bFile = ReadAllBytesFromFile(filePath)

    BuildMultipartBody = ConcatBytes(bHead, bFile, bFoot)
End Function

Private Function Utf8Bytes(ByVal s As String) As Byte()
    Dim stm As Object
    Set stm = CreateObject("ADODB.Stream")
    stm.Type = 2 ' adTypeText
    stm.Charset = "utf-8"
    stm.Open
    stm.WriteText s
    stm.Position = 0
    stm.Type = 1 ' adTypeBinary
    Utf8Bytes = stm.Read
    stm.Close
End Function

Private Function ReadAllBytesFromFile(ByVal path As String) As Byte()
    Dim stm As Object
    Set stm = CreateObject("ADODB.Stream")
    stm.Type = 1
    stm.Open
    stm.LoadFromFile path
    ReadAllBytesFromFile = stm.Read
    stm.Close
End Function

Private Function ConcatBytes(ByRef a() As Byte, ByRef b() As Byte, ByRef c() As Byte) As Byte()
    Dim la As Long, lb As Long, lc As Long
    la = UBound(a) - LBound(a) + 1
    lb = UBound(b) - LBound(b) + 1
    lc = UBound(c) - LBound(c) + 1

    Dim out() As Byte
    ReDim out(0 To la + lb + lc - 1)

    Dim i As Long, p As Long
    p = 0
    For i = LBound(a) To UBound(a)
        out(p) = a(i): p = p + 1
    Next i
    For i = LBound(b) To UBound(b)
        out(p) = b(i): p = p + 1
    Next i
    For i = LBound(c) To UBound(c)
        out(p) = c(i): p = p + 1
    Next i
    ConcatBytes = out
End Function

Private Sub SaveBinaryToFile(ByRef respBody As Variant, ByVal path As String)
    Dim stm As Object
    Set stm = CreateObject("ADODB.Stream")
    stm.Type = 1
    stm.Open
    stm.Write respBody
    stm.SaveToFile path, 2 ' adSaveCreateOverWrite
    stm.Close
End Sub

Private Function RemoveTrailingSlash(ByVal s As String) As String
    Dim t As String
    t = s
    Do While Len(t) > 0 And (Right$(t, 1) = "/" Or Right$(t, 1) = "\")
        t = Left$(t, Len(t) - 1)
    Loop
    RemoveTrailingSlash = t
End Function
