; Custom NSIS installer script for DSH Trading Desktop
; Includes:
; 1. Detection and silent installation of Microsoft Visual C++ 2015-2022 Redistributable (x64)
; 2. Uninstallation prompt asking the user whether to clean ~/.dsh-trading and user app data
;
; MessageBox copy is selected from $LANGUAGE (NSIS language id):
;   1049 = Russian, 2052 = Simplified Chinese, else English.
; Keep UTF-8 BOM so Windows makensis does not mis-decode non-ASCII strings.

!macro customInstall
  DetailPrint "Checking Microsoft Visual C++ 2015-2022 Redistributable (x64)..."
  SetRegView 64
  ClearErrors
  ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X64" "Installed"
  ${If} ${Errors}
    StrCpy $0 0
  ${EndIf}

  ${If} $0 != 1
    DetailPrint "Visual C++ Redistributable not detected. Installing..."
    InitPluginsDir
    !if /FileExists "${BUILD_RESOURCES_DIR}\redist\vc_redist.x64.exe"
      File /oname=$PLUGINSDIR\vc_redist.x64.exe "${BUILD_RESOURCES_DIR}\redist\vc_redist.x64.exe"
      ExecWait '"$PLUGINSDIR\vc_redist.x64.exe" /install /quiet /norestart' $1
      DetailPrint "Visual C++ Redistributable install exited with code $1"
      Delete "$PLUGINSDIR\vc_redist.x64.exe"
    !else
      DetailPrint "Notice: Bundled vc_redist.x64.exe not found during build, skipping automatic install."
    !endif
  ${Else}
    DetailPrint "Visual C++ Redistributable is already installed."
  ${EndIf}
  SetRegView default
!macroend

!macro customUnInstall
  ; Only clear the dsh-trading home (~/.dsh-trading). Never touch ~/.dsh
  ; (shared home of the dsh web host and CLI).
  ; Silent uninstall (/S) answers No via /SD IDNO — keep data unless the user
  ; explicitly agrees in an interactive box. Default button is No.
  StrCmp $LANGUAGE 1049 uninstall_ask_ru
  StrCmp $LANGUAGE 2052 uninstall_ask_zh
  Goto uninstall_ask_en

  uninstall_ask_ru:
    MessageBox MB_ICONQUESTION|MB_YESNO|MB_DEFBUTTON2 "Также удалить пользовательские торговые данные и настройки (включая ~/.dsh-trading и локальный кэш)?$\r$\n$\r$\n[Да] Полностью удалить данные и настройки$\r$\n[Нет] Сохранить данные для повторной установки" /SD IDNO IDNO skipUserData
    Goto uninstall_clean

  uninstall_ask_zh:
    MessageBox MB_ICONQUESTION|MB_YESNO|MB_DEFBUTTON2 "是否同时清除用户交易数据与配置目录（包括 ~/.dsh-trading 和本地缓存）？$\r$\n$\r$\n【是】完全删除数据与配置$\r$\n【否】保留用户数据以便重新安装" /SD IDNO IDNO skipUserData
    Goto uninstall_clean

  uninstall_ask_en:
    MessageBox MB_ICONQUESTION|MB_YESNO|MB_DEFBUTTON2 "Also remove user trading data and settings (including ~/.dsh-trading and local caches)?$\r$\n$\r$\n[Yes] Delete data and settings completely$\r$\n[No] Keep user data for reinstall" /SD IDNO IDNO skipUserData

  uninstall_clean:
    DetailPrint "Cleaning user data directory (~/.dsh-trading)..."
    RMDir /r "$PROFILE\.dsh-trading"
    RMDir /r "$APPDATA\dsh-trading-desktop"
    RMDir /r "$LOCALAPPDATA\dsh-trading-desktop"
  skipUserData:
!macroend
