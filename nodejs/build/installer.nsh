; filepath: build/installer.nsh
!macro customInit
  ; Kill the app if running
  nsExec::ExecToLog 'taskkill /F /IM "cac-demat-node.exe"'
  Sleep 500
  
  ; Try to rename the old folder first (works even with some locked files)
  ; Then delete the renamed folder
  IfFileExists "$INSTDIR\*.*" 0 done
    Rename "$INSTDIR" "$INSTDIR.old"
    RMDir /r "$INSTDIR.old"
    
    ; If rename failed, try direct removal
    IfFileExists "$INSTDIR\*.*" 0 done
      nsExec::ExecToLog 'cmd /c rd /s /q "$INSTDIR"'
      
  done:
!macroend

!macro customUnInit
  nsExec::ExecToLog 'taskkill /F /IM "cac-demat-node.exe"'
  Sleep 500
!macroend