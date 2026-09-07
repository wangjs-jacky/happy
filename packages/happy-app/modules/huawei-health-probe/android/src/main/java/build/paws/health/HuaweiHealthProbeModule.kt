package build.paws.health

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val HUAWEI_HEALTH_PACKAGE = "com.huawei.health"
private const val HMS_CORE_PACKAGE = "com.huawei.hwid"
private const val PUBLISHED_DEVICE_SIDE_MAX_API = 33

class HuaweiHealthProbeModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("HuaweiHealthProbe")

    AsyncFunction("getStatus") {
      val packageManager = context.packageManager
      val huaweiHealth = packageManager.findPackage(HUAWEI_HEALTH_PACKAGE)
      val hmsCore = packageManager.findPackage(HMS_CORE_PACKAGE)

      mapOf(
        "androidApiLevel" to Build.VERSION.SDK_INT,
        "deviceSidePublishedMaxApiLevel" to PUBLISHED_DEVICE_SIDE_MAX_API,
        "requiresAndroid14CompatibilityTest" to (Build.VERSION.SDK_INT > PUBLISHED_DEVICE_SIDE_MAX_API),
        "huaweiHealth" to packageStatus(HUAWEI_HEALTH_PACKAGE, huaweiHealth),
        "hmsCore" to packageStatus(HMS_CORE_PACKAGE, hmsCore),
      )
    }
  }

  private fun packageStatus(packageName: String, packageInfo: PackageInfo?) = mapOf(
    "packageName" to packageName,
    "installed" to (packageInfo != null),
    "versionName" to packageInfo?.versionName,
    "versionCode" to packageInfo?.let(::longVersionCode)?.toString(),
  )
}

private fun PackageManager.findPackage(packageName: String): PackageInfo? =
  try {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(0))
    } else {
      @Suppress("DEPRECATION")
      getPackageInfo(packageName, 0)
    }
  } catch (_: PackageManager.NameNotFoundException) {
    null
  }

private fun longVersionCode(packageInfo: PackageInfo): Long =
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
    packageInfo.longVersionCode
  } else {
    @Suppress("DEPRECATION")
    packageInfo.versionCode.toLong()
  }
