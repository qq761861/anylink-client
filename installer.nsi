!macro customInstall
  ; 先清理可能残留的旧服务（首次安装时服务不存在会失败，可忽略）
  ExecWait '"$INSTDIR\resources\bin\anylink_client_agent.exe" uninstall'
  ; 安装服务
  ExecWait '"$INSTDIR\resources\bin\anylink_client_agent.exe" install'
!macroend

!macro customUnInstall
  ExecWait '"$INSTDIR\resources\bin\anylink_client_agent.exe" uninstall'
!macroend
