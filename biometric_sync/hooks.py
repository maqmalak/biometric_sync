app_name = "biometric_sync"
app_title = "Biometric Sync"
app_publisher = "Biometric Sync"
app_description = "Multi-device biometric attendance sync for ERPNext / HRMS"
app_email = "admin@example.com"
app_license = "MIT"

required_apps = ["hrms"]

after_install = "biometric_sync.install.after_install"

# ZKTeco ADMS / iclock push protocol:  /iclock/cdata, /iclock/getrequest, /iclock/devicecmd
page_renderer = ["biometric_sync.adms.ADMSRenderer"]

doc_events = {
	"Employee": {
		"on_update": "biometric_sync.sync.on_employee_update",
	},
}

scheduler_events = {
	"cron": {
		# decides per device (Sync Every N Minutes) whether a pull sync is due
		"* * * * *": ["biometric_sync.tasks.schedule_device_syncs"],
	},
	"hourly_long": ["biometric_sync.tasks.retry_unmatched_logs"],
	"daily_long": ["biometric_sync.tasks.cleanup_old_logs"],
}
