; Custom NSIS installer script for DSH Trading Desktop
; Includes:
; 1. Detection and silent installation of Microsoft Visual C++ 2015-2022 Redistributable (x64)
; 2. Uninstallation prompt asking the user whether to clean ~/.dsh-trading and user app data
;
; Uninstall copy is Russian only (no zh/en branches). Keep UTF-8 BOM so Windows
; makensis does not mis-decode Cyrillic strings.

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
  MessageBox MB_ICONQUESTION|MB_YESNO|MB_DEFBUTTON2 "Также удалить пользовательские торговые данные и настройки (включая ~/.dsh-trading и локальный кэш)?$\r$\n$\r$\n[Да] Полностью удалить данные и настройки$\r$\n[Нет] Сохранить данные для повторной установки" /SD IDNO IDNO skipUserData
    DetailPrint "Cleaning user data directory (~/.dsh-trading)..."
    RMDir /r "$PROFILE\.dsh-trading"
    RMDir /r "$APPDATA\dsh-trading-desktop"
    RMDir /r "$LOCALAPPDATA\dsh-trading-desktop"
  skipUserData:
!macroend
